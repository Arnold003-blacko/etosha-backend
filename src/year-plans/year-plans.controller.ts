import { Controller, Get } from '@nestjs/common';
import { YearPlansService } from './year-plans.service';

@Controller('year-plans') // this must match your URL path
export class YearPlansController {
  constructor(private readonly yearPlansService: YearPlansService) {}

  @Get()
  async getAll() {
    return this.yearPlansService.findAll();
  }
}
