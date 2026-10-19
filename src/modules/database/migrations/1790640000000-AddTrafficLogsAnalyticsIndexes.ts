import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTrafficLogsAnalyticsIndexes1790640000000 implements MigrationInterface {
  name = 'AddTrafficLogsAnalyticsIndexes1790640000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_traffic_logs_apiKeyId_timestamp" ON "traffic_logs" ("apiKeyId", "timestamp")`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_traffic_logs_model_timestamp" ON "traffic_logs" ("model", "timestamp")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_traffic_logs_model_timestamp"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_traffic_logs_apiKeyId_timestamp"`);
  }
}
