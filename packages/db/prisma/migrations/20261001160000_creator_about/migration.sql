-- An author's "about": birth date (zodiac, age, a birthday notice to
-- subscribers), city and country. All optional.
ALTER TABLE "CreatorProfile" ADD COLUMN "birthDate" DATE,
ADD COLUMN "showBirthYear" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "city" TEXT,
ADD COLUMN "country" TEXT,
ADD COLUMN "birthdayNotifiedYear" INTEGER;
