-- CreateEnum
CREATE TYPE "ProxyStatus" AS ENUM ('AVAILABLE', 'IN_USE', 'DISABLED', 'BANNED');

-- CreateEnum
CREATE TYPE "ProxyProtocol" AS ENUM ('HTTP', 'HTTPS', 'SOCKS5');

-- CreateTable
CREATE TABLE "Proxy" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "protocol" "ProxyProtocol" NOT NULL DEFAULT 'HTTP',
    "username" TEXT,
    "passwordEnc" TEXT,
    "region" TEXT,
    "status" "ProxyStatus" NOT NULL DEFAULT 'AVAILABLE',
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Proxy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Proxy_status_idx" ON "Proxy"("status");

-- CreateIndex
CREATE INDEX "Proxy_region_idx" ON "Proxy"("region");

-- CreateIndex
CREATE UNIQUE INDEX "Proxy_host_port_protocol_key" ON "Proxy"("host", "port", "protocol");
