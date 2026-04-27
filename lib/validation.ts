import { z } from "zod";

export const schedulePayloadSchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  name: z.string().trim().min(1).max(120),
  courses: z.array(z.unknown()).max(200),
});

export const notificationPayloadSchema = z.object({
  to: z.string().email().optional(),
  crn: z.string().trim().min(1).max(20),
  title: z.string().trim().max(200).optional(),
  status: z.string().trim().max(40).optional(),
  term: z.string().trim().max(40).optional(),
  restrictionsChanged: z.boolean().optional(),
});
