import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit
{
  async onModuleInit() {
    await this.$connect();

    // 🔑 Proper shutdown handling (CRITICAL)
    this.$on('beforeExit', async () => {
      await this.$disconnect();
    });
  }
}
