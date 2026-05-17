import { IsInt, Min } from 'class-validator';

export class VotePollDto {
  @IsInt()
  @Min(0)
  optionIndex: number;
}
