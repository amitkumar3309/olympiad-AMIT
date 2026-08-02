export interface Student {
  fullName: string
  mobile: string
  studentId: string
}

export interface Admin {
  email: string
}

export interface TopicMetric {
  topicName: string
  attempted: number
  correct: number
}

export interface LearningPoint {
  date: string
  accuracy: number
}

export interface AnalyticsData {
  overallAccuracy: number
  averageSpeedPerQuestion: number
  totalQuestionsAttempted: number
  topicMetrics: TopicMetric[]
  learningCurve: LearningPoint[]
  aiInsights: string[]
}
