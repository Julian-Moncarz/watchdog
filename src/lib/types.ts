export interface ExtractedClaim {
  claim: string;
  speaker?: string;
  context?: string;
}

export type Verdict = "TRUE" | "FALSE" | "MOSTLY_TRUE" | "MOSTLY_FALSE" | "UNVERIFIABLE";

export interface VerificationResult {
  verdict: Verdict;
  confidence: number;
  response: string;
  sources: string[];
}

export interface CheckedClaim extends ExtractedClaim {
  id: string;
  verification: VerificationResult;
  timestamp: number;
}

export interface QuestionAnswer {
  id: string;
  question: string;
  answer: string;
  confidence: number;
  sources: string[];
  timestamp: number;
}