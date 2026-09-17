-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('SUPERADMIN', 'FINANCE', 'OPS');

-- CreateEnum
CREATE TYPE "PlatformMembershipStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "NavArea" AS ENUM ('DASHBOARD', 'BACKOFFICE');

-- CreateTable
CREATE TABLE "PlatformMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "PlatformRole" NOT NULL,
    "status" "PlatformMembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NavSection" (
    "id" TEXT NOT NULL,
    "area" "NavArea" NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NavSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NavItem" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "badge" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "allowedPlatformRoles" "PlatformRole"[],
    "allowedOrgRoles" "MembershipRole"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NavItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformMembership_userId_key" ON "PlatformMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "NavSection_area_key_key" ON "NavSection"("area", "key");

-- CreateIndex
CREATE UNIQUE INDEX "NavItem_sectionId_key_key" ON "NavItem"("sectionId", "key");

-- AddForeignKey
ALTER TABLE "PlatformMembership" ADD CONSTRAINT "PlatformMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NavItem" ADD CONSTRAINT "NavItem_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "NavSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
