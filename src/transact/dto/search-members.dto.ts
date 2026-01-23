import { IsString, MinLength } from 'class-validator';

export class SearchMembersDto {
  @IsString()
  @MinLength(2, { message: 'Search query must be at least 2 characters' })
  q: string;
}
