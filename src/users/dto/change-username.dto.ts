import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class ChangeUsernameDto {
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: 'username may contain only letters, digits and underscores',
  })
  username: string;
}
