import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));

  app.enableCors({
    origin: [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3002',
      'https://socialnetworkfrontend-nine.vercel.app',
    ],
    credentials: true,
  });

  const port = process.env.PORT || 4000;

  try {
    await app.listen(port);
    console.log(`Server running on http://localhost:${port}`);
  } catch (error) {
    if (error.code === 'EADDRINUSE') {
      console.error(
        `Port ${port} is already in use. Please free the port and try again.`,
      );
      process.exit(1);
    }
    throw error;
  }
}
bootstrap();
