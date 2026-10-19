import { Controller, Get, Inject, UseGuards } from '@nestjs/common';

import { AdminGuard } from '@/modules/proxy-gateway/server/guards/admin.guard';
import { getMaxOutputTokens } from '@/modules/proxy-gateway/antigravity/ModelSpecs';
import { OpenAIOperations } from './openai-operations.service';

interface ModelSpecEntry {
  id: string;
  maxOutputTokens: number;
}

/**
 * Per-model limits for the dashboard, deliberately kept out of `/v1/models`.
 *
 * That endpoint is OpenAI-shaped and clients read it verbatim, so extra fields
 * there would be a compatibility risk. The dashboard only needs the output
 * ceiling to write an accurate client config — and the proxy clamps generation
 * to it server-side regardless of what the client asks for, so a client
 * configured too low silently truncates its own replies.
 */
@Controller('internal/model-specs')
@UseGuards(AdminGuard)
export class ModelSpecsController {
  constructor(
    @Inject(OpenAIOperations)
    private readonly operations: OpenAIOperations,
  ) {}

  @Get()
  listModelSpecs(): { success: boolean; data: ModelSpecEntry[] } {
    // Reads out of the identical published catalog /v1/models serves, so the
    // dashboard and the picker never disagree on which models exist.
    const ids = this.operations.listOpenAICompatibleModelIds();

    return {
      success: true,
      data: ids.map((id) => ({
        id,
        maxOutputTokens: getMaxOutputTokens(id),
      })),
    };
  }
}
