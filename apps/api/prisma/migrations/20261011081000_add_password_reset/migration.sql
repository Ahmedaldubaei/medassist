-- Add password-reset fields to User (forgot/reset password via Resend email).
-- hasPassword=false marks Google-only accounts (no usable password).
ALTER TABLE "User" ADD COLUMN "resetToken" TEXT;
ALTER TABLE "User" ADD COLUMN "resetTokenExpiry" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "hasPassword" BOOLEAN NOT NULL DEFAULT true;
CREATE UNIQUE INDEX "User_resetToken_key" ON "User"("resetToken");
