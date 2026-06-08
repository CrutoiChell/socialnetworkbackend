import { IsString, Length } from 'class-validator';

export class WarnUserDto {
  @IsString()
  @Length(3, 500)
  message: string;
}
