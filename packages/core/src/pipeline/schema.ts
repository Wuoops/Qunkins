import { z } from 'zod';

export const PipelineStepSchema = z.object({
  run: z.string().min(1),
  name: z.string().optional(),
  timeout: z.number().positive().optional(),
});

export const PipelineStageSchema = z.object({
  name: z.string().min(1),
  steps: z.array(PipelineStepSchema).min(1),
});

export const PipelineDockerSchema = z.object({
  context: z.string().default('.'),
  dockerfile: z.string().default('Dockerfile'),
  image: z.string().optional(),
  build_args: z.record(z.string()).optional(),
});

export const PipelineYamlSchema = z.object({
  version: z.string().default('1'),
  name: z.string().min(1),
  docker: PipelineDockerSchema.default({}),
  stages: z.array(PipelineStageSchema).min(1),
  artifacts: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  notify: z.object({
    on_success: z.boolean().default(false),
    on_failure: z.boolean().default(true),
  }).optional(),
});

export type PipelineStep = z.infer<typeof PipelineStepSchema>;
export type PipelineStage = z.infer<typeof PipelineStageSchema>;
export type PipelineDocker = z.infer<typeof PipelineDockerSchema>;
export type PipelineYaml = z.infer<typeof PipelineYamlSchema>;
