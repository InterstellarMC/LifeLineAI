export type SeverityLevel = 'LOW' | 'MODERATE' | 'EMERGENCY' | 'UNKNOWN';

export interface RecommendedHospital {
  name: string;
  address: string;
  travelTime: string;
}

export interface TriageStatus {
  condition: string; // Probable condition
  riskLevel: SeverityLevel;
  immediateAction: string; // First aid steps
  hospitalUrgency: 'STAY_HOME' | 'VISIT_DOCTOR' | 'RUSH_TO_ER';
  department: string; // e.g., Cardiology, Orthopedics
  contraindications: string; // What NOT to do
  reasoning: string; // Medical reasoning
  recommendedHospital?: RecommendedHospital; // Nearest facility
  lastUpdated: number;
  source?: 'LIVE_OBSERVATION' | 'DEEP_SCAN'; // To distinguish between video stream vs static upload analysis
}

export interface MessageLog {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}