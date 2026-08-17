-- Per-user "Ask Viktor" chat history: each TeamMember can have many
-- AiConversations, each carrying many AiMessages. Cascades keep cleanup
-- clean — deleting a team member wipes all their chats; deleting a chat
-- wipes its messages. No cross-user access is possible at the DB level:
-- every query must scope by teamMemberId.

CREATE TABLE "AiConversation" (
    "id"             TEXT NOT NULL,
    "teamMemberId"   TEXT NOT NULL,
    "title"          TEXT,
    "viktorThreadId" TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiConversation_teamMemberId_updatedAt_idx"
    ON "AiConversation" ("teamMemberId", "updatedAt" DESC);

ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_teamMemberId_fkey"
    FOREIGN KEY ("teamMemberId") REFERENCES "TeamMember"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;


CREATE TABLE "AiMessage" (
    "id"              TEXT NOT NULL,
    "conversationId"  TEXT NOT NULL,
    "role"            TEXT NOT NULL,
    "body"            TEXT NOT NULL,
    "attachmentsJson" JSONB,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiMessage_conversationId_createdAt_idx"
    ON "AiMessage" ("conversationId", "createdAt");

ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
