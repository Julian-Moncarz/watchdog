export interface ExtractedClaim {
  claim: string;
  speaker: string;
  context: string;
}

export type Verdict = "TRUE" | "FALSE" | "MOSTLY_TRUE" | "MOSTLY_FALSE" | "UNVERIFIABLE";

export interface Source {
  title: string;
  url: string;
}

export interface VerificationResult {
  verdict: Verdict;
  confidence: number;
  explanation: string;
  correction: string | null;
  sources: Source[];
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
  sources: Source[];
  caveats: string | null;
  timestamp: number;
}

export interface TranscriptChunk {
  speaker: string;
  text: string;
  timestamp: number;
}
