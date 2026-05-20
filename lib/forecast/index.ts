/**
 * lib/forecast/index.ts — Public API for the GM Co-Pilot forecast engine
 */

export { getForecastInputs } from "./inputs";
export { buildGMBriefing } from "./briefing";
export {
  generateSalesForecast,
  generateCoversForecast,
  generateHourlyForecast,
  generateLabourGuidance,
  calculateConfidenceScore,
} from "./engine";
export { generateRecommendations } from "./recommendations";
export { generateRiskAssessment } from "./risks";
export { generatePrepGuidance } from "./prep";
export { generatePromoInsights } from "./promos";
export { compareActualVsForecast } from "./pacing";
export { getMockGMBriefing, getMockForecastInput } from "./mock";
