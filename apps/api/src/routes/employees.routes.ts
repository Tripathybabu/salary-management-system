import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  employeeQuerySchema,
  createEmployeeSchema,
  updateEmployeeSchema,
  createSalaryRecordSchema,
} from '@salary/shared';
import {
  listEmployees,
  getEmployeeById,
  createEmployee,
  updateEmployee,
  getFilterOptions,
} from '../services/employee.service.js';
import { recordSalaryChange, getSalaryHistory } from '../services/salary.service.js';
import { asyncHandler } from '../middleware/error-handler.js';

export const employeeRoutes = Router();

/**
 * Routes parse, delegate, and serialise. No business logic lives here - that keeps
 * the services testable without spinning up HTTP.
 */

employeeRoutes.get(
  '/filters',
  asyncHandler(async (_req, res) => {
    res.json(await getFilterOptions());
  }),
);

employeeRoutes.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = employeeQuerySchema.parse(req.query);
    res.json(await listEmployees(query));
  }),
);

employeeRoutes.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await getEmployeeById(employeeIdFrom(req)));
  }),
);

employeeRoutes.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = createEmployeeSchema.parse(req.body);
    const employee = await createEmployee(input, actorFrom(req));
    res.status(201).json(employee);
  }),
);

employeeRoutes.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = updateEmployeeSchema.parse(req.body);
    res.json(await updateEmployee(employeeIdFrom(req), input, actorFrom(req)));
  }),
);

employeeRoutes.get(
  '/:id/salary-history',
  asyncHandler(async (req, res) => {
    res.json(await getSalaryHistory(employeeIdFrom(req)));
  }),
);

employeeRoutes.post(
  '/:id/salary',
  asyncHandler(async (req, res) => {
    const input = createSalaryRecordSchema.parse(req.body);
    const result = await recordSalaryChange(employeeIdFrom(req), input, actorFrom(req));
    res.status(201).json(result);
  }),
);

/**
 * Who performed this action, for the audit trail.
 *
 * With no auth, this reads a header and falls back to 'system'. When auth lands it
 * reads req.user instead - the audit field is already threaded through every
 * service, so only this function changes. See docs/ARCHITECTURE.md §7.
 */
function actorFrom(req: Request): string {
  return req.header('x-actor-id') ?? 'system';
}

/**
 * Extract and validate the :id path parameter.
 *
 * Express 5 types route params as `string | string[]`, since a repeated parameter
 * can produce an array. Validating as a UUID both resolves that type and rejects
 * malformed ids with a clean 400, rather than letting Postgres raise an
 * invalid-input-syntax error that would surface as an opaque 500.
 */
const uuidParam = z.string().uuid('Invalid employee id');

function employeeIdFrom(req: Request): string {
  return uuidParam.parse(req.params.id);
}
