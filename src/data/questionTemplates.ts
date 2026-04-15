/**
 * Industry-specific discovery question templates
 * Moved from database seed (005_question_templates.sql) to static file
 */

const templates: Record<string, string[]> = {
  default: [
    'What specific challenges are you facing in your business right now?',
    'How is your current solution falling short of expectations?',
    'What would success look like for you in the next 12 months?',
    'Who else is involved in making decisions like this?',
    'What is your timeline for making a change?',
  ],
  healthcare: [
    'What compliance requirements are most challenging for your organization?',
    'How are you currently handling patient data security?',
    'What inefficiencies exist in your current clinical workflows?',
    'How do you measure patient outcomes today?',
    'What is your biggest staffing challenge right now?',
  ],
  technology: [
    'What is your current tech stack and where are the pain points?',
    'How do you handle scaling during peak demand?',
    'What is your deployment frequency and what blocks you from going faster?',
    'How do you manage technical debt prioritization?',
    'What is your approach to developer productivity?',
  ],
  manufacturing: [
    'What is your biggest bottleneck in production?',
    'How do you currently track quality metrics?',
    'What is your approach to predictive maintenance?',
    'How are supply chain disruptions affecting your operations?',
    'What automation initiatives are you considering?',
  ],
  professional_services: [
    'How do you currently manage client relationships and communication?',
    'What is your utilization rate and how are you tracking it?',
    'How do you handle knowledge sharing across your team?',
    'What is your biggest challenge in client acquisition?',
    'How are you differentiating from competitors?',
  ],
  trades: [
    'What is your current approach to scheduling and dispatch?',
    'How do you handle seasonal fluctuations in demand?',
    'What is your biggest challenge with workforce management?',
    'How are you generating leads today?',
    'What does your customer retention strategy look like?',
  ],
};

/**
 * Get discovery questions for an industry, with fallback to default
 */
export function getQuestionsForIndustry(industryKey: string): string[] {
  return templates[industryKey] || templates.default;
}
