import {
  IsString,
  IsOptional,
} from 'class-validator';

export class CreatePostDto {
  @IsString()
  @IsOptional()
  content: string;

  @IsString()
  @IsOptional()
  embedUrl?: string;

  @IsString()
  @IsOptional()
  isAd?: string;

  @IsString()
  @IsOptional()
  adTargetUrl?: string;

  @IsString()
  @IsOptional()
  spoilerFlags?: string;

  @IsString()
  @IsOptional()
  poll?: string;

  @IsString()
  @IsOptional()
  locationName?: string;

  @IsString()
  @IsOptional()
  locationLat?: string;

  @IsString()
  @IsOptional()
  locationLng?: string;
}
