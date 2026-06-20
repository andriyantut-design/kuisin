import React, { useState, useEffect, useRef } from "react";
import {
  Upload,
  BookOpen,
  Award,
  History as HistoryIcon,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Database,
  Plus,
  ArrowRight,
  RefreshCcw,
  BookOpenText,
  FileText,
  Calendar,
  X,
  Sparkles,
  ChevronRight,
  LogIn,
  LogOut,
  User,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Quiz, QuizQuestion, QuizHistoryEntry, DatabaseStatus } from "./types.ts";

export default function App() {
  const [activeTab, setActiveTab] = useState<"new-quiz" | "history">("new-quiz");
  const [dbStatus, setDbStatus] = useState<DatabaseStatus>({
    connected: false,
    error: null,
    usingFallback: true,
  });
  const [showSettings, setShowSettings] = useState(false);
  const [customDbUrl, setCustomDbUrl] = useState("");
  const [dbStatusMessage, setDbStatusMessage] = useState("");

  // User Authentication State
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [userToken, setUserToken] = useState<string | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  // Quiz Generation State
  const [pastedText, setPastedText] = useState("");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [base64File, setBase64File] = useState<string | null>(null);
  const [questionCount, setQuestionCount] = useState<5 | 10 | 15>(5);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Active Quiz State
  const [activeQuiz, setActiveQuiz] = useState<Quiz | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<{ [key: number]: number }>({});
  const [quizScore, setQuizScore] = useState<number | null>(null);
  const [quizCompleted, setQuizCompleted] = useState(false);

  // History State
  const [quizHistory, setQuizHistory] = useState<QuizHistoryEntry[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch Database connection status, listen to auth, and fetch history
  useEffect(() => {
    fetchDbStatus();

    // Dynamically listen to Firebase state changes to allow lazy sign-in loading
    let unsubscribe: () => void = () => {};
    import("./db/firebase-client.ts").then(({ auth }) => {
      unsubscribe = auth.onAuthStateChanged(async (user) => {
        if (user) {
          setCurrentUser(user);
          const token = await user.getIdToken();
          setUserToken(token);
          loadQuizHistory(token);
        } else {
          setCurrentUser(null);
          setUserToken(null);
          loadQuizHistory(null);
        }
        setIsAuthLoading(false);
      });
    }).catch((err) => {
      console.warn("Failed to import firebase package dynamically:", err);
      setIsAuthLoading(false);
      loadQuizHistory(null);
    });

    return () => unsubscribe();
  }, []);

  const fetchDbStatus = async () => {
    try {
      const res = await fetch("/api/db-status");
      const status: DatabaseStatus = await res.json();
      setDbStatus(status);
    } catch (e) {
      setDbStatus({
        connected: false,
        error: "Unreachable server backend - verify your local host environment is running.",
        usingFallback: true,
      });
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      const { loginWithGoogle } = await import("./db/firebase-client.ts");
      const { user, token } = await loginWithGoogle();
      setCurrentUser(user);
      setUserToken(token);
      loadQuizHistory(token);
    } catch (err: any) {
      console.error("Sign in failed:", err);
    }
  };

  const handleSignOut = async () => {
    try {
      const { logout } = await import("./db/firebase-client.ts");
      await logout();
      setCurrentUser(null);
      setUserToken(null);
      loadQuizHistory(null);
    } catch (err) {
      console.error("Sign out failed:", err);
    }
  };

  const loadQuizHistory = async (tokenOverride?: string | null) => {
    setIsLoadingHistory(true);
    const activeToken = tokenOverride !== undefined ? tokenOverride : userToken;
    
    // 1. Load from localStorage as a default
    const localHistoryStr = localStorage.getItem("kuisIn_history");
    const localHistory: QuizHistoryEntry[] = localHistoryStr ? JSON.parse(localHistoryStr) : [];

    try {
      const headers: Record<string, string> = {};
      if (activeToken) {
        headers["Authorization"] = `Bearer ${activeToken}`;
      }
      const res = await fetch("/api/quiz/history", { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.dbConnected) {
          const merged = [...data.history];
          // Fill missing ones from local if any unique ID is not present
          localHistory.forEach((local) => {
            if (!merged.some((m) => m.id === local.id)) {
              merged.push(local);
            }
          });
          merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          setQuizHistory(merged);
        } else {
          setQuizHistory(localHistory);
        }
      } else {
        setQuizHistory(localHistory);
      }
    } catch (err) {
      console.warn("Failed to retrieve quiz history, defaulting to localStorage:", err);
      setQuizHistory(localHistory);
    } finally {
      setIsLoadingHistory(false);
    }
  };


  const handlePostgresConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customDbUrl.trim()) return;

    setDbStatusMessage("Connecting...");
    try {
      const res = await fetch("/api/reconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ databaseUrl: customDbUrl.trim() }),
      });

      const data = await res.json();
      if (data.success) {
        setDbStatus(data.status);
        setDbStatusMessage("🟢 Succesfully linked PostgreSQL database!");
        setTimeout(() => {
          setShowSettings(false);
          setDbStatusMessage("");
        }, 1500);
        // Reload history
        loadQuizHistory();
      } else {
        setDbStatus(data.status);
        setDbStatusMessage(`❌ Connection failed: ${data.error}`);
      }
    } catch (err: any) {
      setDbStatusMessage(`❌ Fetch error trying to connect: ${err.message}`);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split(".").pop()?.toLowerCase();
    const isValidType =
      file.type === "application/pdf" ||
      file.type === "text/plain" ||
      file.type === "text/markdown" ||
      ["pdf", "txt", "md"].includes(ext || "");

    if (!isValidType) {
      setGenerateError("Unsupported file type. Only PDF (.pdf), Text (.txt), or Markdown (.md) documents are accepted.");
      return;
    }

    setUploadedFile(file);
    setGenerateError(null);

    const reader = new FileReader();

    if (file.type === "application/pdf" || ext === "pdf") {
      reader.onload = () => {
        const result = reader.result as string;
        const b64 = result.split(",")[1];
        setBase64File(b64);
        setPastedText(""); // Clear pasted text context to avoid collision
      };
      reader.readAsDataURL(file);
    } else {
      // standard txt or md
      reader.onload = () => {
        setPastedText(reader.result as string);
        setBase64File(null);
      };
      reader.readAsText(file);
    }
  };

  const handleClearFile = () => {
    setUploadedFile(null);
    setBase64File(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    const ext = file.name.split(".").pop()?.toLowerCase();
    const isValidType =
      file.type === "application/pdf" ||
      file.type === "text/plain" ||
      file.type === "text/markdown" ||
      ["pdf", "txt", "md"].includes(ext || "");

    if (!isValidType) {
      setGenerateError("Unsupported file type. Only PDF (.pdf), Text (.txt), or Markdown (.md) documents are accepted.");
      return;
    }

    setUploadedFile(file);
    setGenerateError(null);

    const reader = new FileReader();
    if (file.type === "application/pdf" || ext === "pdf") {
      reader.onload = () => {
        const result = reader.result as string;
        const b64 = result.split(",")[1];
        setBase64File(b64);
        setPastedText("");
      };
      reader.readAsDataURL(file);
    } else {
      reader.onload = () => {
        setPastedText(reader.result as string);
        setBase64File(null);
      };
      reader.readAsText(file);
    }
  };

  const handleGenerateQuiz = async () => {
    if (!base64File && (!pastedText || pastedText.trim().length < 50)) {
      setGenerateError("Please enter lecture notes/study material with at least 50 letters, or upload a formatted document.");
      return;
    }

    setIsGenerating(true);
    setGenerateError(null);

    try {
      const payload = {
        text: pastedText ? pastedText.trim() : null,
        fileData: base64File,
        fileName: uploadedFile ? uploadedFile.name : "Custom Study Session",
        questionCount,
      };

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (userToken) {
        headers["Authorization"] = `Bearer ${userToken}`;
      }

      const res = await fetch("/api/quiz/generate", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || "An unexpected generation issue was returned from the server.");
      }

      const responseData = await res.json();
      if (responseData.success && responseData.quiz) {
        // Cache the newly created quiz locally so we can reference it
        const cachedquizzes = JSON.parse(localStorage.getItem("kuisIn_quizzes_cache") || "{}");
        cachedquizzes[responseData.quiz.id] = responseData.quiz;
        localStorage.setItem("kuisIn_quizzes_cache", JSON.stringify(cachedquizzes));

        // Start Quiz
        setActiveQuiz(responseData.quiz);
        setCurrentQuestionIndex(0);
        setSelectedAnswers({});
        setQuizScore(null);
        setQuizCompleted(false);
        setActiveTab("new-quiz");
      }
    } catch (err: any) {
      setGenerateError(err.message || "Failed to process the material. Please check that the PDF is descriptive and readable.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSelectAnswer = (optionIdx: number) => {
    // Prevent overriding already selected answer
    if (optionIdx === selectedAnswers[currentQuestionIndex]) return;
    
    // Lock the answer
    setSelectedAnswers({
      ...selectedAnswers,
      [currentQuestionIndex]: optionIdx,
    });
  };

  const handleNextQuestion = () => {
    if (activeQuiz && currentQuestionIndex < activeQuiz.questions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
    }
  };

  const handlePrevQuestion = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(currentQuestionIndex - 1);
    }
  };

  const handleFinishQuiz = async () => {
    if (!activeQuiz) return;

    let score = 0;
    activeQuiz.questions.forEach((q, idx) => {
      if (selectedAnswers[idx] === q.correctOptionIndex) {
        score++;
      }
    });

    setQuizScore(score);
    setQuizCompleted(true);

    const historyEntry: QuizHistoryEntry = {
      id: crypto.randomUUID(),
      quizId: activeQuiz.id,
      quizTitle: activeQuiz.title,
      score,
      totalQuestions: activeQuiz.questions.length,
      createdAt: new Date().toISOString(),
    };

    // Save to LocalStorage + Database (optimistic client-local first)
    const localHistoryStr = localStorage.getItem("kuisIn_history");
    const localHistory: QuizHistoryEntry[] = localHistoryStr ? JSON.parse(localHistoryStr) : [];
    localStorage.setItem("kuisIn_history", JSON.stringify([historyEntry, ...localHistory]));

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (userToken) {
        headers["Authorization"] = `Bearer ${userToken}`;
      }

      const res = await fetch("/api/quiz/history", {
        method: "POST",
        headers,
        body: JSON.stringify(historyEntry),
      });
      // Refresh list
      loadQuizHistory();
    } catch (e) {
      console.warn("Failed to synchronize score to server postgres:", e);
      // fallback history display list updated locally directly
      setQuizHistory((prev) => [historyEntry, ...prev]);
    }
  };

  const handleReviewSavedQuiz = async (quizId: string) => {
    try {
      // Look up cached locally first
      const cachedQuizzes = JSON.parse(localStorage.getItem("kuisIn_quizzes_cache") || "{}");
      if (cachedQuizzes[quizId]) {
        setActiveQuiz(cachedQuizzes[quizId]);
        setCurrentQuestionIndex(0);
        setSelectedAnswers({});
        setQuizScore(null);
        setQuizCompleted(false);
        setActiveTab("new-quiz");
        return;
      }

      const headers: Record<string, string> = {};
      if (userToken) {
        headers["Authorization"] = `Bearer ${userToken}`;
      }

      // If not cached, fetch from Postgres DB
      const res = await fetch(`/api/quiz/${quizId}`, { headers });
      if (res.ok) {
        const body = await res.json();
        if (body.success && body.quiz) {
          // Put in cache
          cachedQuizzes[quizId] = body.quiz;
          localStorage.setItem("kuisIn_quizzes_cache", JSON.stringify(cachedQuizzes));

          setActiveQuiz(body.quiz);
          setCurrentQuestionIndex(0);
          setSelectedAnswers({});
          setQuizScore(null);
          setQuizCompleted(false);
          setActiveTab("new-quiz");
        } else {
          setGenerateError("Failed to load historical quiz - database is unreacheable and file is missing.");
          setActiveTab("new-quiz");
        }
      } else {
        setGenerateError("Quiz record not found in the Database or secure offline storage cache.");
        setActiveTab("new-quiz");
      }
    } catch (err) {
      setGenerateError("Unable to retrieve old quiz content. Connection or network error.");
      setActiveTab("new-quiz");
    }
  };

  const handleQuizExit = () => {
    setActiveQuiz(null);
    setCurrentQuestionIndex(0);
    setSelectedAnswers({});
    setQuizScore(null);
    setQuizCompleted(false);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans text-gray-800">
      {/* HEADER NAV BAR */}
      <header className="bg-white border-b border-gray-100 shadow-xs sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3 cursor-pointer" onClick={handleQuizExit}>
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-md shadow-blue-200">
              <Sparkles className="w-5 h-5 text-white animate-pulse" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-blue-900 leading-tight">KuisIn</h1>
              <p className="text-xs text-blue-600 font-medium">AI Quiz Generator</p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <nav className="flex space-x-2 mr-2">
              <button
                id="tab-new-quiz"
                onClick={() => {
                  setActiveTab("new-quiz");
                  if (quizCompleted) handleQuizExit(); // reset if finished
                }}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-all decoration-none ${
                  activeTab === "new-quiz"
                    ? "bg-blue-50 text-blue-700 font-semibold"
                    : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                }`}
              >
                New Quiz
              </button>
              <button
                id="tab-history"
                onClick={() => {
                  setActiveTab("history");
                  loadQuizHistory();
                }}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-all decoration-none ${
                  activeTab === "history"
                    ? "bg-blue-50 text-blue-700 font-semibold"
                    : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                }`}
              >
                History
              </button>
            </nav>

            {/* FIREBASE AUTH GOOGLE SIGN IN BUTTON */}
            {isAuthLoading ? (
              <div className="h-9 px-3 rounded-lg flex items-center justify-center border border-gray-100 bg-gray-50 text-xs text-gray-400 select-none">
                <RefreshCcw className="w-3.5 h-3.5 animate-spin mr-1.5" />
                <span>Loading...</span>
              </div>
            ) : currentUser ? (
              <div className="flex items-center space-x-1.5 bg-blue-50 border border-blue-100 p-1.5 pr-3 rounded-lg">
                {currentUser.photoURL ? (
                  <img
                    src={currentUser.photoURL}
                    referrerPolicy="no-referrer"
                    alt={currentUser.displayName || "Avatar"}
                    className="w-6 h-6 rounded-md object-cover shadow-xs border border-blue-200"
                  />
                ) : (
                  <div className="w-6 h-6 rounded-md bg-blue-600 flex items-center justify-center text-white">
                    <User className="w-3.5 h-3.5" />
                  </div>
                )}
                <span className="text-[11px] font-semibold text-blue-800 hidden md:inline truncate max-w-[80px]">
                  {currentUser.displayName || "Student"}
                </span>
                <button
                  id="auth-logout-btn"
                  onClick={handleSignOut}
                  title="Logout"
                  className="p-1 text-blue-700 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors cursor-pointer ml-1"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                id="auth-login-btn"
                onClick={handleGoogleSignIn}
                className="h-9 px-3 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg flex items-center space-x-1.5 shadow-xs transition-all cursor-pointer"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Sign In</span>
              </button>
            )}

            {/* DB STATUS TOGGLE */}
            <button
              id="db-btn"
              onClick={() => setShowSettings(!showSettings)}
              className={`p-2 rounded-lg flex items-center space-x-1 border text-xs font-semibold select-none cursor-pointer transition-all ${
                dbStatus.connected
                  ? "bg-green-50 border-green-200 text-green-700 hover:bg-green-100"
                  : "bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100"
              }`}
            >
              <Database className="w-4 h-4" />
              <span className="hidden sm:inline">
                {dbStatus.connected ? "DB Connected" : "Sandbox (Offline)"}
              </span>
              <div
                className={`w-2.5 h-2.5 rounded-full ml-1 ${
                  dbStatus.connected ? "bg-green-500 animate-pulse" : "bg-amber-500"
                }`}
              />
            </button>
          </div>
        </div>
      </header>

      {/* BACKEND STATUS POP OVER */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-white border-b border-gray-200 shadow-md py-5 z-40 relative"
          >
            <div className="max-w-xl mx-auto px-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center space-x-2 text-blue-900 font-bold">
                  <Database className="w-5 h-5 text-blue-600" />
                  <h3>PostgreSQL Database Connection</h3>
                </div>
                <button
                  onClick={() => setShowSettings(false)}
                  className="p-1 hover:bg-gray-100 rounded-full transition-colors text-gray-400"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-xs text-gray-500 mb-4 leading-relaxed">
                KuisIn uses PostgreSQL as a database to store and synchronize quiz outputs, content sources, and scoring logs dynamically.
                If you haven&apos;t provided a URL, we maintain progress safely inside your local sandbox.
              </p>

              {dbStatus.connected ? (
                <div className="mb-4 p-3 bg-green-50 rounded-xl border border-green-200 flex items-center space-x-3 text-xs text-green-800">
                  <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
                  <div>
                    <p className="font-bold">PostgreSQL linked and fully optimized!</p>
                    <p className="text-gray-500 mt-0.5">We are currently synchronizing and parsing records to your PostgreSQL database.</p>
                  </div>
                </div>
              ) : (
                <div className="mb-4 p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-800 space-y-1">
                  <div className="flex items-center space-x-2 font-bold">
                    <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                    <span>Using Local Sandbox Fallback</span>
                  </div>
                  <p className="text-gray-600">
                    Database is currently unreachable. History and caches are preserved safely within your browser&apos;s localStorage.
                  </p>
                  {dbStatus.error && (
                    <p className="mt-1 font-mono text-[10px] bg-amber-100 bg-opacity-50 p-1.5 rounded text-amber-900 block overflow-auto max-h-16">
                      Error: {dbStatus.error}
                    </p>
                  )}
                </div>
              )}

              <form onSubmit={handlePostgresConnect} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Connect Remote Postgres URL (URL format)
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="postgresql://username:password@hostname:3000/databasename"
                    value={customDbUrl}
                    onChange={(e) => setCustomDbUrl(e.target.value)}
                    className="w-full text-xs p-3 rounded-lg border border-gray-200 outline-none focus:ring-1 focus:ring-blue-500 text-gray-700 bg-gray-50"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-blue-600">{dbStatusMessage}</span>
                  <button
                    type="submit"
                    className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg text-xs tracking-wide transition-all shadow-md shadow-blue-100 cursor-pointer"
                  >
                    Connect Database
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MAIN CONTAINER */}
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-8">
        {/* BANNER NOTIFICATION (FALLBACK ENGINE NOTICE) */}
        {!dbStatus.connected && !showSettings && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-100 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between shadow-xs gap-3">
            <div className="flex items-center space-x-3 text-amber-800">
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0" />
              <div className="text-xs">
                <span className="font-bold mr-1">Working Offline:</span>
                Utilizing secure sandbox browser memory. Click DB on navbar to connect your database at any time.
              </div>
            </div>
            <button
              onClick={() => setShowSettings(true)}
              className="text-xs font-semibold text-blue-700 bg-white hover:bg-amber-100 border border-amber-200 px-3 py-1.5 rounded-lg transition-all"
            >
              Connect DB
            </button>
          </div>
        )}

        {generateError && (
          <div className="mb-6 p-4 bg-red-50 border border-red-100 text-red-800 rounded-xl flex items-start space-x-3 text-xs leading-relaxed animate-fade-in shadow-xs">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
            <div className="flex-1">
              <p className="font-bold mb-0.5">Quiz Generator Issue</p>
              <p className="text-gray-600">{generateError}</p>
            </div>
            <button
              onClick={() => setGenerateError(null)}
              className="text-red-500 hover:text-red-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* STUDY MATERIAL UPLOAD TAB */}
        {activeTab === "new-quiz" && !activeQuiz && (
          <div className="space-y-6">
            <div className="text-center max-w-xl mx-auto space-y-2 mb-4">
              <h2 className="text-3xl font-extrabold tracking-tight text-blue-900">
                Transform Study Notes into Active Practice
              </h2>
              <p className="text-sm text-gray-500 leading-relaxed">
                Paste lecture notes or upload standard PDFs, TXT, or MD documents.
                Our Gemini AI engine will instantly build multiple-choice quizzing tests.
              </p>
            </div>

            <div className="bg-white p-6 sm:p-8 rounded-2xl border border-gray-100 shadow-sm space-y-6">
              {/* UPLOAD & TEXT BOX SWITCHER */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Drag and Drop Zone */}
                <div
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  className={`border-2 border-dashed rounded-xl p-6 text-center flex flex-col items-center justify-center transition-all ${
                    uploadedFile
                      ? "border-blue-500 bg-blue-50/30"
                      : "border-gray-200 hover:border-blue-400 bg-gray-50/50"
                  }`}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept=".pdf,.txt,.md"
                    className="hidden"
                  />

                  {uploadedFile ? (
                    <div className="space-y-3">
                      <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center mx-auto text-blue-600">
                        {uploadedFile.name.endsWith(".pdf") ? (
                          <BookOpenText className="w-6 h-6" />
                        ) : (
                          <FileText className="w-6 h-6" />
                        )}
                      </div>
                      <div>
                        <p className="text-xs font-bold text-gray-800 max-w-[200px] truncate mx-auto">
                          {uploadedFile.name}
                        </p>
                        <p className="text-[10px] text-gray-500 mt-0.5">
                          {(uploadedFile.size / 1024).toFixed(1)} KB
                        </p>
                      </div>
                      <button
                        onClick={handleClearFile}
                        className="text-xs font-bold text-red-600 hover:text-red-700 bg-white shadow-xs border border-red-100 px-3 py-1 rounded-lg transition-all"
                      >
                        Remove File
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center mx-auto text-blue-600">
                        <Upload className="w-6 h-6" />
                      </div>
                      <div>
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs px-4 py-2 rounded-lg transition-all shadow-md shadow-blue-100 cursor-pointer"
                        >
                          Choose Document
                        </button>
                        <p className="text-xs text-gray-500 mt-2.5">
                          Drag and Drop here or Browse files
                        </p>
                        <p className="text-[10px] text-gray-400 mt-1">
                          Supports PDF, TXT or MD files
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* PASTE TEXT BOX */}
                <div className="flex flex-col">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-bold text-gray-700 flex items-center space-x-1">
                      <BookOpen className="w-4 h-4 text-blue-500" />
                      <span>Paste Lecture Notes / Text</span>
                    </label>
                    {pastedText.length > 0 && (
                      <span className="text-[10px] text-gray-400 font-semibold">
                        {pastedText.length} characters
                      </span>
                    )}
                  </div>
                  <textarea
                    rows={6}
                    placeholder="Enter or paste your chapters, lecture transcripts, syllabus outline or copy Markdown notes here to begin generating multiple choice questions..."
                    value={pastedText}
                    onChange={(e) => {
                      setPastedText(e.target.value);
                      if (uploadedFile) handleClearFile(); // Prioritize text box if actively typing
                    }}
                    className="w-full text-xs p-4 rounded-xl border border-gray-200 outline-none focus:ring-1 focus:ring-blue-500 text-gray-700 bg-gray-50 resize-none flex-1 placeholder:text-gray-400"
                  />
                </div>
              </div>

              {/* OPTIONS ROW (QUESTION COUNT) */}
              <div className="pt-4 border-t border-gray-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider">Number of Questions</h4>
                  <p className="text-xs text-gray-400">Select the desired size for your study evaluation evaluation test.</p>
                </div>
                <div className="flex bg-gray-100 p-1 rounded-xl space-x-1 select-none">
                  {[5, 10, 15].map((count) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => setQuestionCount(count as 5 | 10 | 15)}
                      className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${
                        questionCount === count
                          ? "bg-white text-blue-700 shadow-sm"
                          : "text-gray-500 hover:text-gray-800 hover:bg-gray-50"
                      }`}
                    >
                      {count} Questions
                    </button>
                  ))}
                </div>
              </div>

              {/* ACTION GENERATE ACTION BUTTON */}
              <div className="pt-2 flex flex-col items-center">
                <button
                  type="button"
                  id="generate-quiz-btn"
                  disabled={isGenerating}
                  onClick={handleGenerateQuiz}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-bold py-3.5 px-6 rounded-xl transition-all shadow-md shadow-blue-200 tracking-wide flex items-center justify-center space-x-2 text-sm cursor-pointer"
                >
                  {isGenerating ? (
                    <>
                      <RefreshCcw className="w-5 h-5 animate-spin" />
                      <span>Generating with Gemini AI...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-5 h-5" />
                      <span>Generate Multiple-Choice Quiz</span>
                    </>
                  )}
                </button>
                <p className="text-[10px] text-gray-400 mt-2 text-center">
                  Quiz creation uses the advanced <strong className="text-blue-500 font-semibold">Gemini 3.5 Flash</strong> model to build optimized explanations.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ACTIVE INTERACTIVE QUIZ INTERFACE */}
        {activeQuiz && (
          <div className="space-y-6">
            {/* Quiz Banner Panel */}
            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-start justify-between">
              <div className="space-y-1">
                <div className="flex items-center space-x-2 text-xs font-bold text-blue-600 uppercase tracking-widest">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>KuisIn Generated Session</span>
                </div>
                <h2 className="text-xl font-extrabold text-blue-950">{activeQuiz.title}</h2>
                <div className="flex items-center space-x-3 text-xs text-gray-400 mt-1">
                  <span>Source: {activeQuiz.contentSource}</span>
                  <span>•</span>
                  <span>{activeQuiz.questions.length} Total Questions</span>
                </div>
              </div>
              <button
                type="button"
                onClick={handleQuizExit}
                className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold px-3 py-1.5 rounded-lg transition-all"
              >
                Exit Session
              </button>
            </div>

            {/* QUIZ COMPLETION SUMMARY */}
            {quizCompleted && quizScore !== null ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-white p-8 rounded-2xl border border-gray-100 shadow-sm text-center space-y-6"
              >
                <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center mx-auto text-blue-600">
                  <Award className="w-8 h-8" />
                </div>

                <div className="space-y-2">
                  <h3 className="text-2xl font-bold text-gray-900">Quiz Completed!</h3>
                  <p className="text-sm text-gray-500">
                    You have finished evaluation for <strong className="text-blue-950 font-bold">{activeQuiz.title}</strong>
                  </p>
                </div>

                <div className="max-w-xs mx-auto bg-gray-50 border border-gray-100 p-6 rounded-xl flex items-center justify-center space-x-4">
                  <div className="text-center">
                    <span className="block text-4xl font-extrabold text-blue-600">
                      {Math.round((quizScore / activeQuiz.questions.length) * 100)}%
                    </span>
                    <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Score Value</span>
                  </div>
                  <div className="h-10 w-px bg-gray-200" />
                  <div className="text-left text-xs">
                    <p className="font-semibold text-gray-700">Correct: {quizScore} Questions</p>
                    <p className="text-gray-500">Total Size: {activeQuiz.questions.length} questions</p>
                  </div>
                </div>

                <div className="flex items-center justify-center space-x-3 pt-2">
                  <button
                    onClick={() => {
                      // Reset and retry same quiz
                      setSelectedAnswers({});
                      setQuizScore(null);
                      setQuizCompleted(false);
                      setCurrentQuestionIndex(0);
                    }}
                    className="bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold text-xs px-5 py-2.5 rounded-xl transition-all"
                  >
                    Retry Quiz
                  </button>
                  <button
                    onClick={handleQuizExit}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-5 py-2.5 rounded-xl transition-all shadow-md shadow-blue-100"
                  >
                    Generate Another Quiz
                  </button>
                </div>
              </motion.div>
            ) : (
              /* ACTIVE EXAM RUNNER CARD */
              <div className="space-y-4">
                {/* Progress Indicators */}
                <div className="flex items-center justify-between text-xs font-semibold text-gray-400 px-1">
                  <span>
                    Question <strong className="text-blue-900 font-bold">{currentQuestionIndex + 1}</strong> of{" "}
                    {activeQuiz.questions.length}
                  </span>
                  <div className="flex space-x-1.5">
                    {activeQuiz.questions.map((_, idx) => {
                      const isAnswered = selectedAnswers[idx] !== undefined;
                      const isActive = currentQuestionIndex === idx;
                      return (
                        <div
                          key={idx}
                          className={`w-2.5 h-2.5 rounded-full transition-all ${
                            isActive
                              ? "bg-blue-600 scale-125"
                              : isAnswered
                              ? "bg-blue-300"
                              : "bg-gray-200"
                          }`}
                        />
                      );
                    })}
                  </div>
                </div>

                {/* THE ACTIVE QUESTION WRAPPER */}
                <div className="bg-white p-6 sm:p-8 rounded-2xl border border-gray-100 shadow-sm space-y-6">
                  {/* Current Question Text */}
                  <h3 className="text-base sm:text-lg font-bold text-gray-900 leading-relaxed leading-6">
                    {activeQuiz.questions[currentQuestionIndex].question}
                  </h3>

                  {/* Multi-choice Answers Options */}
                  <div className="grid grid-cols-1 gap-3.5">
                    {activeQuiz.questions[currentQuestionIndex].options.map((option, opIdx) => {
                      const answeredIdx = selectedAnswers[currentQuestionIndex];
                      const isAnswered = answeredIdx !== undefined;
                      const isCorrectAnswer = opIdx === activeQuiz.questions[currentQuestionIndex].correctOptionIndex;
                      const isSelectedAnswer = opIdx === answeredIdx;

                      // Decide Styling Classes Dynamically
                      let btnClasses = "w-full text-left p-4 rounded-xl border text-xs font-medium tracking-wide transition-all duration-200 flex items-center justify-between ";
                      let badge = null;

                      if (!isAnswered) {
                        btnClasses += "border-gray-100 hover:border-blue-400 hover:bg-blue-50 text-gray-700 bg-gray-50/50 cursor-pointer active:scale-[0.99]";
                      } else {
                        // Answered state - lock editing
                        if (isCorrectAnswer) {
                          // Correct choices turn green
                          btnClasses += "border-green-500 bg-green-50 text-green-800 font-semibold shadow-xs";
                          badge = <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 ml-2" />;
                        } else if (isSelectedAnswer) {
                          // Selected wrong choice turns red
                          btnClasses += "border-red-500 bg-red-50 text-red-800 font-semibold";
                          badge = <XCircle className="w-5 h-5 text-red-600 flex-shrink-0 ml-2" />;
                        } else {
                          // Non-selected wrong choice stays muted
                          btnClasses += "border-gray-100 bg-gray-50 text-gray-400 cursor-not-allowed opacity-60";
                        }
                      }

                      return (
                        <button
                          key={opIdx}
                          type="button"
                          disabled={isAnswered}
                          onClick={() => handleSelectAnswer(opIdx)}
                          className={btnClasses}
                        >
                          <div className="flex items-start">
                            <span className="w-5 h-5 rounded-md bg-white border border-gray-100 flex items-center justify-center font-bold text-[10px] text-gray-400 mr-3 flex-shrink-0 mt-0.5 shadow-2xs">
                              {String.fromCharCode(65 + opIdx)}
                            </span>
                            <span>{option}</span>
                          </div>
                          {badge}
                        </button>
                      );
                    })}
                  </div>

                  {/* EXPLANATION BOX (Reveal smoothly underneath) */}
                  <AnimatePresence>
                    {selectedAnswers[currentQuestionIndex] !== undefined && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="bg-blue-50/50 border border-blue-100 rounded-xl p-4 sm:p-5 mt-4 text-xs text-blue-900 leading-relaxed overflow-hidden"
                      >
                        <div className="flex items-center space-x-2 text-blue-700 font-bold uppercase tracking-widest mb-2 font-mono text-[10px]">
                          <Sparkles className="w-3.5 h-3.5 animate-pulse" />
                          <span>Gemini Explains:</span>
                        </div>
                        <p>{activeQuiz.questions[currentQuestionIndex].explanation}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* NAV CONTROLS ROW */}
                  <div className="pt-4 border-t border-gray-100 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={handlePrevQuestion}
                      disabled={currentQuestionIndex === 0}
                      className="px-4 py-2 text-xs font-semibold rounded-lg text-gray-500 hover:text-gray-850 bg-gray-100 hover:bg-gray-150 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                    >
                      Previous
                    </button>

                    {currentQuestionIndex === activeQuiz.questions.length - 1 ? (
                      <button
                        type="button"
                        onClick={handleFinishQuiz}
                        disabled={selectedAnswers[currentQuestionIndex] === undefined}
                        className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-bold text-xs px-5 py-2.5 rounded-lg transition-all shadow-md shadow-blue-100 flex items-center space-x-1 cursor-pointer"
                      >
                        <span>Submit Quiz Answers</span>
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleNextQuestion}
                        disabled={selectedAnswers[currentQuestionIndex] === undefined}
                        className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-bold text-xs px-5 py-2.5 rounded-lg transition-all shadow-md shadow-blue-100 flex items-center space-x-1 cursor-pointer"
                      >
                        <span>Next Question</span>
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* QUIZ HISTORY DASHBOARD */}
        {activeTab === "history" && (
          <div className="bg-white p-6 sm:p-8 rounded-2xl border border-gray-100 shadow-sm space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-gray-100 gap-2">
              <div className="flex items-center space-x-3 text-blue-900">
                <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600 shadow-2xs">
                  <HistoryIcon className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <h3 className="text-lg font-bold">Quiz Performance History</h3>
                  <p className="text-xs text-gray-400">Keep track of every quiz generated, created dates, and your evaluation metrics.</p>
                </div>
              </div>
              <button
                onClick={loadQuizHistory}
                className="p-2 border border-gray-200 hover:bg-gray-50 rounded-lg text-gray-500 transition-colors cursor-pointer text-xs font-semibold flex items-center justify-center gap-1.5"
                title="Refresh logs from database"
              >
                <RefreshCcw className="w-3.5 h-3.5" />
                <span>Refresh Logs</span>
              </button>
            </div>

            {isLoadingHistory ? (
              <div className="py-12 text-center text-xs text-gray-400 flex flex-col items-center space-y-3">
                <RefreshCcw className="w-6 h-6 text-blue-500 animate-spin" />
                <span>Syncing scoring stats from active logs...</span>
              </div>
            ) : quizHistory.length === 0 ? (
              <div className="py-12 text-center text-xs text-gray-400 max-w-sm mx-auto space-y-3">
                <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mx-auto text-gray-300">
                  <FileText className="w-6 h-6" />
                </div>
                <p className="font-semibold text-gray-700 text-sm">No quizzes completed yet</p>
                <p className="text-gray-400 leading-relaxed text-[11px]">
                  Go to the &quot;New Quiz&quot; tab above, upload or paste notes, complete the test, and your scoring tracking details will load dynamically right here.
                </p>
                <button
                  onClick={() => setActiveTab("new-quiz")}
                  className="mt-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs py-2 px-4 rounded-lg transition-all"
                >
                  Create Your First Quiz
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {quizHistory.map((item) => {
                  const scorePercentage = Math.round((item.score / item.totalQuestions) * 100);
                  // Decide grading badge
                  let labelColor = "bg-red-50 text-red-700 border-red-150";
                  if (scorePercentage >= 80) labelColor = "bg-green-50 text-green-700 border-green-150";
                  else if (scorePercentage >= 50) labelColor = "bg-blue-50 text-blue-700 border-blue-150";

                  return (
                    <div
                      key={item.id}
                      className="border border-gray-100 rounded-xl p-5 bg-gray-50 bg-opacity-30 flex items-start justify-between hover:shadow-xs transition-shadow"
                    >
                      <div className="space-y-2 flex-1 min-w-0 pr-3">
                        <span className="inline-flex items-center space-x-1 font-mono text-[9px] text-gray-400 uppercase font-semibold">
                          <Calendar className="w-3 h-3" />
                          <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                        </span>
                        <h4 className="text-xs font-bold text-gray-900 truncate leading-tight">
                          {item.quizTitle}
                        </h4>
                        <div className="text-[11px] text-gray-500">
                          <span>Questions: {item.totalQuestions}</span>
                        </div>
                        <button
                          onClick={() => handleReviewSavedQuiz(item.quizId)}
                          className="text-[11px] font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 cursor-pointer transition-colors pt-1"
                        >
                          <span>Analyze/Retry Quiz</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>

                      <div className="text-center flex-shrink-0">
                        <div className={`px-2.5 py-1.5 rounded-lg border text-sm font-bold ${labelColor} leading-none`}>
                          {item.score} / {item.totalQuestions}
                        </div>
                        <span className="text-[9px] text-gray-400 block mt-1 font-semibold">{scorePercentage}% Score</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>

      {/* FOOTER */}
      <footer className="mt-auto py-5 border-t border-gray-100 text-center text-[11px] text-gray-400 opacity-80 leading-relaxed max-w-5xl mx-auto w-full px-4 flex flex-col sm:flex-row items-center justify-between gap-2 bg-transparent">
        <div>
          <span>&copy; {new Date().getFullYear()} KuisIn — AI Quiz Generator.</span>
        </div>
        <div className="flex items-center space-x-2">
          <span>Engineered via Gemini 3.5 Flash &amp; Node-Postgres connection pools.</span>
        </div>
      </footer>
    </div>
  );
}
