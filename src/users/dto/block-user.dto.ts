import { IsInt, IsOptional, Min } from 'class-validator';

export class BlockUserDto {
  /** Длительность блокировки в часах. Если не указана — блокировка постоянная. */
  @IsOptional()
  @IsInt()
  @Min(1)
  hours?: number;
}
