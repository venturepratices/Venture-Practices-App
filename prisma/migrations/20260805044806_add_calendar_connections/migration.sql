-- CreateTable
CREATE TABLE "TeamMemberCalendarConnection" (
    "id" TEXT NOT NULL,
    "teamMemberId" TEXT NOT NULL,
    "googleEmail" TEXT,
    "encryptedAccessToken" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT NOT NULL,
    "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "calendarId" TEXT NOT NULL DEFAULT 'primary',
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamMemberCalendarConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMemberBusyBlock" (
    "id" TEXT NOT NULL,
    "teamMemberId" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "lastSyncAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMemberBusyBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeamMemberCalendarConnection_teamMemberId_key" ON "TeamMemberCalendarConnection"("teamMemberId");

-- CreateIndex
CREATE INDEX "TeamMemberBusyBlock_teamMemberId_startTime_endTime_idx" ON "TeamMemberBusyBlock"("teamMemberId", "startTime", "endTime");

-- AddForeignKey
ALTER TABLE "TeamMemberCalendarConnection" ADD CONSTRAINT "TeamMemberCalendarConnection_teamMemberId_fkey" FOREIGN KEY ("teamMemberId") REFERENCES "TeamMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMemberBusyBlock" ADD CONSTRAINT "TeamMemberBusyBlock_teamMemberId_fkey" FOREIGN KEY ("teamMemberId") REFERENCES "TeamMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
