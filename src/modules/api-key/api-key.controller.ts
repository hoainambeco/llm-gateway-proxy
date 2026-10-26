import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { AdminGuard } from "../proxy-gateway/server/guards/admin.guard";
import { ApiKeyService } from "./api-key.service";
import { CreateApiKeyDto, UpdateApiKeyDto } from "./dto/api-key.dto";
import type { ApiKey } from "./entities/api-key.entity";

/**
 * Wire shape for a stored key. `key` carries the masked preview, not a credential;
 * `keyHash` never leaves the server.
 */
function toApiKeyView(record: ApiKey) {
  const { keyHash: _keyHash, keyPreview, ...rest } = record;
  return { ...rest, key: keyPreview };
}

@Controller("internal/api-keys")
@UseGuards(AdminGuard)
export class ApiKeyController {
  constructor(
    @Inject(ApiKeyService) private readonly apiKeyService: ApiKeyService,
  ) {}

  @Get()
  async listKeys() {
    const keys = await this.apiKeyService.listKeys();
    return {
      success: true,
      data: keys.map(toApiKeyView),
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createKey(@Body() body: CreateApiKeyDto) {
    const { record, key } = await this.apiKeyService.createKey(body);
    return {
      success: true,
      // The only response that carries the key itself: the database keeps just its
      // digest, so there is no endpoint that can hand it back later.
      data: { ...toApiKeyView(record), key },
      message:
        "API Key created successfully. Copy it now -- only a hash is stored, so it cannot be shown again.",
    };
  }

  @Get(":id")
  async getKey(@Param("id") id: string) {
    const key = await this.apiKeyService.getKeyById(id);
    return {
      success: true,
      data: toApiKeyView(key),
    };
  }

  @Patch(":id")
  async updateKey(@Param("id") id: string, @Body() body: UpdateApiKeyDto) {
    const updated = await this.apiKeyService.updateKey(id, body);
    return {
      success: true,
      data: toApiKeyView(updated),
      message: "API Key updated successfully",
    };
  }

  @Delete(":id")
  async deleteKey(@Param("id") id: string) {
    await this.apiKeyService.deleteKey(id);
    return {
      success: true,
      message: `API Key with ID ${id} deleted successfully`,
    };
  }
}
