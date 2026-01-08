import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import * as bodyParser from 'body-parser';
import morgan from 'morgan';

let app: any; // allow clean shutdown

async function bootstrap() {
  app = await NestFactory.create(AppModule);

  /**
   * 👀 REAL-TIME REQUEST LOGGING (DEV)
   * Logs every request as it happens
   */
  app.use(morgan('dev'));

  /**
   * 📦 BODY PARSERS (ORDER MATTERS)
   * Explicitly define both JSON and urlencoded
   */
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: false }));

  /**
   * 🔐 Global validation
   */
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  /**
   * 🌍 CORS
   */
  app.enableCors({
    origin: true,
    credentials: true,
  });

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port, '0.0.0.0');

  console.log(
    `🚀 Application is running on: http://0.0.0.0:${port}`,
  );
}

bootstrap();

/**
 * 🛑 Graceful shutdown (SIGINT + SIGTERM)
 */
const shutdown = async (signal: string) => {
  console.log(`\n🛑 Shutting down (${signal})...`);

  if (app) {
    await app.close();
  }

  console.log('✅ Server closed.');
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
