-- CreateTable
CREATE TABLE "offers" (
    "offer_id" TEXT NOT NULL,
    "offer_name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "country_name" TEXT,
    "carrier" TEXT,
    "vertical" TEXT,
    "flow" TEXT,
    "payout" DOUBLE PRECISION NOT NULL,
    "currency" TEXT,
    "daily_cap" INTEGER,
    "type_traffic" TEXT,
    "filled_cap" INTEGER,
    "last_conv" TIMESTAMP(3),
    "last_conv_raw" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("offer_id")
);

-- CreateTable
CREATE TABLE "offer_snapshots" (
    "id" SERIAL NOT NULL,
    "offer_id" TEXT NOT NULL,
    "last_conv" TIMESTAMP(3),
    "last_conv_raw" TEXT,
    "filled_cap" INTEGER,
    "payout" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offer_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_history" (
    "id" SERIAL NOT NULL,
    "offer_id" TEXT NOT NULL,
    "offer_name" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_history_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "offer_snapshots" ADD CONSTRAINT "offer_snapshots_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("offer_id") ON DELETE CASCADE ON UPDATE CASCADE;
