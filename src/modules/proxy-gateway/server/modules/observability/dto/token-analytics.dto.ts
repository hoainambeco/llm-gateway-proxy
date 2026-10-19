import { Field, Float, InputType, Int, ObjectType, registerEnumType } from '@nestjs/graphql';

export enum TimeRangePreset {
  ONE_HOUR = 'ONE_HOUR',
  TWENTY_FOUR_HOURS = 'TWENTY_FOUR_HOURS',
  SEVEN_DAYS = 'SEVEN_DAYS',
  THIRTY_DAYS = 'THIRTY_DAYS',
  NINETY_DAYS = 'NINETY_DAYS',
  ONE_YEAR = 'ONE_YEAR',
  CUSTOM = 'CUSTOM',
}

registerEnumType(TimeRangePreset, {
  name: 'TimeRangePreset',
  description: 'Time range preset filters for token analytics',
});

@InputType()
export class TokenStatsFilterInput {
  @Field(() => TimeRangePreset)
  range: TimeRangePreset;

  @Field(() => Float, { nullable: true })
  from?: number;

  @Field(() => Float, { nullable: true })
  to?: number;

  @Field({ nullable: true })
  apiKeyId?: string;
}

@ObjectType()
export class TokenStatsSummary {
  @Field(() => Float)
  totalTokens: number;

  @Field(() => Float)
  promptTokens: number;

  @Field(() => Float)
  completionTokens: number;

  @Field(() => Int)
  totalRequests: number;

  @Field(() => Int)
  successfulRequests: number;

  @Field(() => Int)
  failedRequests: number;

  @Field(() => Float)
  avgLatencyMs: number;

  @Field(() => Float)
  estimatedCostUsd: number;
}

@ObjectType()
export class TimeSeriesDataPoint {
  @Field(() => Float)
  timestamp: number;

  @Field()
  label: string;

  @Field(() => Float)
  promptTokens: number;

  @Field(() => Float)
  completionTokens: number;

  @Field(() => Float)
  totalTokens: number;

  @Field(() => Int)
  requestCount: number;

  @Field(() => Float)
  estimatedCostUsd: number;
}

@ObjectType()
export class ApiKeyTokenUsage {
  @Field()
  apiKeyId: string;

  @Field()
  name: string;

  @Field()
  keyPreview: string;

  @Field(() => Float)
  promptTokens: number;

  @Field(() => Float)
  completionTokens: number;

  @Field(() => Float)
  totalTokens: number;

  @Field(() => Int)
  requestCount: number;

  @Field(() => Float)
  percentage: number;

  @Field(() => Float)
  estimatedCostUsd: number;
}

@ObjectType()
export class ModelTokenUsage {
  @Field()
  model: string;

  @Field(() => Float)
  promptTokens: number;

  @Field(() => Float)
  completionTokens: number;

  @Field(() => Float)
  totalTokens: number;

  @Field(() => Int)
  requestCount: number;

  @Field(() => Float)
  percentage: number;

  @Field(() => Float)
  estimatedCostUsd: number;
}

@ObjectType()
export class TopModelRanking {
  @Field(() => Int)
  rank: number;

  @Field()
  model: string;

  @Field(() => Float)
  totalTokens: number;

  @Field(() => Int)
  requestCount: number;

  @Field(() => Float)
  percentage: number;

  @Field(() => Float)
  estimatedCostUsd: number;
}

@ObjectType()
export class TokenUsageStatsResponse {
  @Field()
  range: string;

  @Field(() => Float)
  from: number;

  @Field(() => Float)
  to: number;

  @Field(() => TokenStatsSummary)
  summary: TokenStatsSummary;

  @Field(() => [TimeSeriesDataPoint])
  timeSeries: TimeSeriesDataPoint[];

  @Field(() => [ApiKeyTokenUsage])
  byApiKey: ApiKeyTokenUsage[];

  @Field(() => [ModelTokenUsage])
  byModel: ModelTokenUsage[];

  @Field(() => [TopModelRanking])
  topModels: TopModelRanking[];
}
