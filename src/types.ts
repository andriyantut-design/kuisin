export interface QuizQuestion {
  question: string;
  options: string[];
  correctOptionIndex: number; // 0, 1, 2, or 3
  explanation: string;
}

export interface Quiz {
  id: string;
  title: string;
  contentSource?: string; // name of file or 'pasted notes'
  questions: QuizQuestion[];
  createdAt: string;
}

export interface QuizHistoryEntry {
  id: string;
  quizId: string;
  quizTitle: string;
  score: number; // number of correct answers
  totalQuestions: number;
  createdAt: string;
}

export interface DatabaseStatus {
  connected: boolean;
  error: string | null;
  usingFallback: boolean;
}
