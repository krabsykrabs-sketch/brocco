import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { validateRecipeInput, serializeRecipe } from "@/lib/recipes";

const anthropic = new Anthropic();

// Client resizes to ~1400px JPEG before upload; this is a hard backstop.
const MAX_IMAGE_B64 = 5_000_000; // ~3.7MB binary
const MAX_IMAGES = 4;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/**
 * POST /api/recipes/scan — extract a recipe from photos of a cookbook page.
 * Body: { images: [{ data: <base64>, mediaType: "image/jpeg" }] } (1-4 pages).
 * The photo is read by Claude vision and discarded — only the structured
 * recipe is stored (Jan's call, July 2026). Saved immediately with source
 * "photo"; the client shows a review sheet (PUT to fix, DELETE to discard).
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!rateLimit(`recipe-scan:${session.userId}`, 20, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Scan limit reached — try again in an hour." }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));
  const images = Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES) : [];
  if (images.length === 0) {
    return NextResponse.json({ error: "At least one image is required" }, { status: 400 });
  }

  const imageBlocks: Anthropic.ImageBlockParam[] = [];
  for (const img of images) {
    const mediaType = ALLOWED_TYPES.includes(img?.mediaType) ? img.mediaType : null;
    const data = typeof img?.data === "string" ? img.data.replace(/^data:[^,]+,/, "") : "";
    if (!mediaType || !data) {
      return NextResponse.json({ error: "Each image needs base64 data and a mediaType (jpeg/png/webp)" }, { status: 400 });
    }
    if (data.length > MAX_IMAGE_B64) {
      return NextResponse.json({ error: "Image too large — max ~3.5MB each" }, { status: 413 });
    }
    imageBlocks.push({ type: "image", source: { type: "base64", media_type: mediaType, data } });
  }

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 3000,
      system: `You extract recipes from photos of cookbook pages. Return ONLY a JSON object:
{
  "found": true,
  "title": "recipe name",
  "servings": 4,                    // integer or null
  "timeMin": 45,                    // total time in minutes, or null
  "ingredients": ["500 g pasta", "2 cloves garlic, minced"],
  "steps": ["Step text...", "..."],
  "tags": ["pasta", "vegetarian"],  // 2-5 short lowercase tags
  "notes": "tips/variations from the page, or null"
}
Rules: KEEP THE RECIPE'S ORIGINAL LANGUAGE — do not translate. One ingredient per array entry with its quantity. Number-free step text (the array order is the numbering). If multiple photos are provided they are pages of the SAME recipe — merge them. If no recipe is legible, return {"found": false, "reason": "why"}.`,
      messages: [
        {
          role: "user",
          content: [...imageBlocks, { type: "text", text: "Extract the recipe from these photos." }],
        },
      ],
    });

    const textBlock = response.content.find((c) => c.type === "text");
    const text = textBlock?.type === "text" ? textBlock.text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;

    if (!parsed || parsed.found === false) {
      return NextResponse.json(
        { error: parsed?.reason ? `No recipe found: ${parsed.reason}` : "Couldn't read a recipe from that photo — try a sharper shot." },
        { status: 422 }
      );
    }

    const validated = validateRecipeInput(parsed);
    if (!validated.ok) {
      console.error("[recipe-scan] extraction failed validation:", validated.error);
      return NextResponse.json({ error: "Couldn't read a complete recipe — try a sharper photo." }, { status: 422 });
    }

    const recipe = await prisma.recipe.create({
      data: {
        userId: session.userId,
        title: validated.recipe.title,
        ingredients: validated.recipe.ingredients,
        steps: validated.recipe.steps,
        tags: validated.recipe.tags,
        servings: validated.recipe.servings,
        timeMin: validated.recipe.timeMin,
        notes: validated.recipe.notes,
        source: "photo",
      },
    });

    return NextResponse.json({ recipe: serializeRecipe(recipe) }, { status: 201 });
  } catch (err) {
    console.error("[recipe-scan] error:", err);
    return NextResponse.json({ error: "Scan failed — try again." }, { status: 502 });
  }
}
