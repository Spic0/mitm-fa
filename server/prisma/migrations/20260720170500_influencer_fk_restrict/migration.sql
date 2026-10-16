-- DropForeignKey
ALTER TABLE "Promotion" DROP CONSTRAINT "Promotion_influencerId_fkey";

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

