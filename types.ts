export interface LandParcel {
  id: string;
  name: string;
  location: string;
  area: string;
  status: 'Verified' | 'Pending' | 'Flagged';
  owner: string;
  hash: string; // Blockchain record hash
  imageUrl: string;
  lastAnalysis?: string;
}

export type LayerId = 'RGB' | 'NDVI' | 'EVI' | 'NDWI';

export interface LayerConfig {
  id: LayerId;
  name: string;
  description: string;
  colors: string[]; // Gradient colors for legend
}

export interface GeoStats {
  min: number;
  max: number;
  mean: number;
  stdDev: number;
  histogram: { bin: string; count: number }[];
}

export interface AnalysisResult {
  suitabilityScore: number;
  landUse: string;
  cropRecommendations: string[];
  risks: string[];
  soilTypeEstimation: string;
  summary: string;
  geoStats?: Record<LayerId, GeoStats>;
}

export enum AppView {
  DASHBOARD = 'DASHBOARD',
  EXPLORER = 'EXPLORER',
  RECORDS = 'RECORDS',
  SETTINGS = 'SETTINGS'
}
