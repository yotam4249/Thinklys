# app/services/openai_service.py
import logging
from openai import OpenAI
from app.core.config import settings

logger = logging.getLogger(__name__)

# Initialize OpenAI client
if not settings.OPENAI_API_KEY.get_secret_value():
    logger.warning("[OPENAI] WARNING: OPENAI_API_KEY is missing in environment")

openai_client = OpenAI(
    api_key=settings.OPENAI_API_KEY.get_secret_value() if settings.OPENAI_API_KEY.get_secret_value() else None,
)


async def ask_openai_question(question: str) -> str:
    """Ask OpenAI a question and get a concise answer."""
    logger.info(f"[OPENAI] ask → {question}")
    try:
        completion = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a concise, helpful teaching assistant."},
                {"role": "user", "content": question},
            ],
        )
        answer = completion.choices[0].message.content or ""
        answer = answer.strip()
        logger.info(f"[OPENAI] answer len: {len(answer)}")
        return answer
    except Exception as e:
        logger.error(f"[OPENAI] Error asking question: {e}")
        raise


async def generate_openai_quiz(topic: str, level: str) -> str:
    """
    NORMAL quiz generator: asks for 5 MCQs, 4 options, with correctIndex.
    Returns JSON string.
    """
    logger.info(f"[OPENAI] quiz (normal) → topic={topic}, level={level}")
    sys_prompt = (
        "You are a teaching assistant. Return STRICT JSON ONLY.\n"
        "Schema:\n"
        '{ "topic": string, "level": string, "items": [\n'
        '  { "id": string, "question": string,\n'
        '    "options": [string, string, string, string],\n'
        '    "correctIndex": number (0..3)\n'
        "  }\n"
        "] }\n"
        "Rules:\n"
        "1) EXACTLY 5 questions.\n"
        "2) ONLY multiple choice (no open).\n"
        "3) Each question MUST have exactly 4 distinct options.\n"
        "4) correctIndex MUST be an integer 0..3.\n"
        "5) No commentary, no markdown. JSON only."
    )
    user_prompt = (
        f'Create a {level} difficulty quiz about "{topic}". '
        "Conform exactly to the schema."
    )

    try:
        completion = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
        )
        content = completion.choices[0].message.content or "{}"
        logger.info(f"[OPENAI] quiz JSON len (normal): {len(content)}")
        return content
    except Exception as e:
        logger.error(f"[OPENAI] Error generating quiz (normal): {e}")
        raise


async def generate_openai_quiz_strict(topic: str, level: str) -> str:
    """
    STRICT retry: repeats schema, emphasizes constraints, and gives a tiny example.
    Returns JSON string.
    """
    logger.info(f"[OPENAI] quiz (STRICT) → topic={topic}, level={level}")
    sys_prompt = (
        "Return STRICT JSON ONLY.\n"
        "Schema:\n"
        '{ "topic": string, "level": string, "items": [\n'
        '  { "id": string, "question": string,\n'
        '    "options": [string, string, string, string],\n'
        '    "correctIndex": number (0..3)\n'
        "  }\n"
        "] }\n"
        "Hard Rules:\n"
        "• EXACTLY 5 questions.\n"
        "• ONLY MCQ; NO 'open' items.\n"
        "• Each 'options' length MUST be 4. Options MUST be distinct strings.\n"
        "• 'id' MUST be a string, not a number.\n"
        "• 'correctIndex' MUST be an integer between 0 and 3.\n"
        "• No commentary, no markdown. JSON only."
    )
    user_prompt = (
        f'Create a {level} difficulty MCQ quiz about "{topic}".\n'
        "Example shape (do not copy values):\n"
        "{\n"
        f'  "topic":"{topic}", "level":"{level}",\n'
        '  "items":[\n'
        '    {"id":"1","question":"...","options":["A","B","C","D"],"correctIndex":1}\n'
        "  ]\n"
        "}"
    )

    try:
        completion = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
        )
        content = completion.choices[0].message.content or "{}"
        logger.info(f"[OPENAI] quiz JSON len (STRICT): {len(content)}")
        return content
    except Exception as e:
        logger.error(f"[OPENAI] Error generating quiz (strict): {e}")
        raise

