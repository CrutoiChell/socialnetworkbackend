import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateBannerDto {
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  bannerUrl?: string | null;
}
