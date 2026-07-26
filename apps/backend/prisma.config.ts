import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

config({ path: '../../.env' });
config();

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    // `prisma generate` не подключается к БД, но Prisma 7 требует URL в config.
    url: process.env.DATABASE_URL
      ?? 'postgresql://letter_box:letter_box_dev@127.0.0.1:5432/letter_box',
  },
});
