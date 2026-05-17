-- CreateEnum
CREATE TYPE "PostsPrivacy" AS ENUM ('ALL', 'FRIENDS', 'ONLY_ME');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "postsPrivacy" "PostsPrivacy" NOT NULL DEFAULT 'ALL';
