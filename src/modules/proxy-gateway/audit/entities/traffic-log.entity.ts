import { Column, Entity, Index, PrimaryColumn } from "typeorm";

@Entity("traffic_logs")
@Index(["apiKeyId", "timestamp"])
@Index(["model", "timestamp"])
export class TrafficLog {
  @PrimaryColumn({ type: "varchar", length: 36 })
  id: string;

  @Index()
  @Column({ type: "varchar", length: 36, nullable: true })
  apiKeyId: string | null;

  @Index()
  @Column({ type: "integer" })
  timestamp: number;

  @Column({ type: "varchar", length: 16 })
  method: string;

  @Column({ type: "varchar", length: 512 })
  endpoint: string;

  @Index()
  @Column({ type: "varchar", length: 128, nullable: true })
  model: string | null;

  @Index()
  @Column({ type: "integer" })
  status: number;

  @Column({ type: "integer", default: 0 })
  latencyMs: number;

  @Column({ type: "integer", default: 0 })
  promptTokens: number;

  @Column({ type: "integer", default: 0 })
  completionTokens: number;

  @Column({ type: "integer", default: 0 })
  totalTokens: number;

  @Column({ type: "text", nullable: true })
  errorMessage: string | null;
}