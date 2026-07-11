import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { validateRecipeInput, serializeRecipe, recipeMatches } from "@/lib/recipes";

/** GET /api/recipes?q=search — the user's recipe library. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = new URL(request.url).searchParams.get("q")?.trim().toLowerCase() || "";

  // Personal libraries are small — fetch and filter in JS, because Prisma's
  // JSON filters can't substring-match inside a JSONB string array.
  const recipes = await prisma.recipe.findMany({
    where: { userId: session.userId },
    orderBy: { updatedAt: "desc" },
    take: 300,
  });

  const filtered = q ? recipes.filter((r) => recipeMatches(r, q)) : recipes;

  return NextResponse.json({ recipes: filtered.slice(0, 100).map(serializeRecipe) });
}

/** POST /api/recipes — save a recipe (manual entry or scan-review confirm). */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const validated = validateRecipeInput(body);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

  const source = ["photo", "chat", "manual"].includes(body.source) ? body.source : "manual";
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
      source,
    },
  });

  return NextResponse.json({ recipe: serializeRecipe(recipe) }, { status: 201 });
}
