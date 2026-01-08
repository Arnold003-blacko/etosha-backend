import { Controller, Get } from '@nestjs/common';
import { UpcomingService } from './upcoming.service';

@Controller('upcoming')
export class UpcomingController {
  constructor(private readonly upcomingService: UpcomingService) {}

  @Get()
  findAll() {
    return this.upcomingService.findAll();
  }
}
