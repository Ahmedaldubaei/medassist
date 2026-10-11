-- Add email verification fields to User (Google sign-in + Resend verification emails).
ALTER TABLE "User" ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "verifyToken" TEXT;
CREATE UNIQUE INDEX "User_verifyToken_key" ON "User"("verifyToken");
