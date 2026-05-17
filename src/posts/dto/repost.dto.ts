import { IsOptional, IsString } from 'class-validator';

export class RepostDto {
  @IsString()
  @IsOptional()
  content?: string;
}
