import { Router } from 'express';
import { z } from 'zod';
import { analyticsQuerySchema, outlierQuerySchema, ANALYTICS_DIMENSIONS } from '@salary/shared';
import {
  getOverview,
  getBreakdown,
  getPayGapReport,
  getPayOutliers,
  getCompensationTrend,
  type AnalyticsFilters,
} from '../services/analytics.service.js';
import { asyncHandler } from '../middleware/error-handler.js';

export const analyticsRoutes = Router();

/** Shared filter parsing - every analytics endpoint accepts the same filters. */
function parseFilters(query: unknown): { filters: AnalyticsFilters; dimension: (typeof ANALYTICS_DIMENSIONS)[number] } {
  const parsed = analyticsQuerySchema.parse(query);
  return {
    dimension: parsed.dimension,
    filters: {
      countryCode: parsed.countryCode,
      departmentId: parsed.departmentId,
      level: parsed.level,
      activeOnly: parsed.activeOnly,
    },
  };
}

analyticsRoutes.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const { filters } = parseFilters(req.query);
    res.json(await getOverview(filters));
  }),
);

analyticsRoutes.get(
  '/breakdown',
  asyncHandler(async (req, res) => {
    const { filters, dimension } = parseFilters(req.query);
    res.json({ dimension, groups: await getBreakdown(dimension, filters) });
  }),
);

analyticsRoutes.get(
  '/pay-gap',
  asyncHandler(async (req, res) => {
    const { filters, dimension } = parseFilters(req.query);
    res.json(await getPayGapReport(dimension, filters));
  }),
);

analyticsRoutes.get(
  '/outliers',
  asyncHandler(async (req, res) => {
    const { filters } = parseFilters(req.query);
    const options = outlierQuerySchema.parse(req.query);
    res.json({
      thresholdPercent: options.thresholdPercent,
      direction: options.direction,
      outliers: await getPayOutliers(filters, options),
    });
  }),
);

analyticsRoutes.get(
  '/trend',
  asyncHandler(async (req, res) => {
    const { filters } = parseFilters(req.query);
    const { months } = z
      .object({ months: z.coerce.number().int().min(3).max(60).default(24) })
      .parse(req.query);
    res.json({ months, points: await getCompensationTrend(filters, months) });
  }),
);
