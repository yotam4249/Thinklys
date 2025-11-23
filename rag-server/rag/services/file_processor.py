# rag/services/file_processor.py
import boto3
from botocore.exceptions import ClientError
from typing import List, Optional
import logging
import io
import PyPDF2
from docx import Document
from rag.core.config import settings

logger = logging.getLogger(__name__)


class FileProcessor:
    """Service for processing files (PDF, DOCX, text) from S3 or local."""
    
    def __init__(self):
        self.s3_client: Optional[boto3.client] = None
        if settings.AWS_ACCESS_KEY_ID.get_secret_value() and settings.S3_BUCKET:
            try:
                self.s3_client = boto3.client(
                    "s3",
                    region_name=settings.AWS_REGION,
                    aws_access_key_id=settings.AWS_ACCESS_KEY_ID.get_secret_value(),
                    aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY.get_secret_value(),
                )
                logger.info("S3 client initialized for file downloads")
            except Exception as e:
                logger.warning(f"Failed to initialize S3 client: {e}")
    
    def download_from_s3(self, s3_key: str) -> bytes:
        """Download a file from S3."""
        if not self.s3_client:
            raise RuntimeError("S3 client not initialized")
        
        try:
            response = self.s3_client.get_object(Bucket=settings.S3_BUCKET, Key=s3_key)
            return response["Body"].read()
        except ClientError as e:
            logger.error(f"Error downloading from S3: {e}", exc_info=True)
            raise
    
    def process_pdf(self, file_content: bytes) -> List[str]:
        """Extract text from PDF file."""
        try:
            pdf_file = io.BytesIO(file_content)
            pdf_reader = PyPDF2.PdfReader(pdf_file)
            
            texts = []
            for page_num, page in enumerate(pdf_reader.pages):
                text = page.extract_text()
                if text.strip():
                    texts.append(text.strip())
            
            logger.info(f"Extracted text from {len(pdf_reader.pages)} PDF pages")
            return texts
        except Exception as e:
            logger.error(f"Error processing PDF: {e}", exc_info=True)
            raise
    
    def process_docx(self, file_content: bytes) -> List[str]:
        """Extract text from DOCX file."""
        try:
            docx_file = io.BytesIO(file_content)
            doc = Document(docx_file)
            
            texts = []
            for paragraph in doc.paragraphs:
                if paragraph.text.strip():
                    texts.append(paragraph.text.strip())
            
            logger.info(f"Extracted text from DOCX document")
            return texts
        except Exception as e:
            logger.error(f"Error processing DOCX: {e}", exc_info=True)
            raise
    
    def process_text(self, file_content: bytes) -> List[str]:
        """Process plain text file."""
        try:
            text = file_content.decode("utf-8")
            # Split into paragraphs
            paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
            return paragraphs
        except Exception as e:
            logger.error(f"Error processing text file: {e}", exc_info=True)
            raise
    
    def process_file(self, file_content: bytes, file_type: str) -> List[str]:
        """Process a file based on its type."""
        file_type_lower = file_type.lower()
        
        if file_type_lower == "application/pdf" or file_type_lower.endswith("pdf"):
            return self.process_pdf(file_content)
        elif file_type_lower in ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/msword"] or file_type_lower.endswith("docx") or file_type_lower.endswith("doc"):
            return self.process_docx(file_content)
        elif file_type_lower.startswith("text/"):
            return self.process_text(file_content)
        else:
            logger.warning(f"Unsupported file type: {file_type}, trying as text")
            return self.process_text(file_content)
    
    def process_files_from_s3(self, s3_keys: List[str], file_types: List[str]) -> List[str]:
        """Download and process multiple files from S3."""
        all_texts = []
        
        for s3_key, file_type in zip(s3_keys, file_types):
            try:
                logger.info(f"Processing file from S3: {s3_key}")
                file_content = self.download_from_s3(s3_key)
                texts = self.process_file(file_content, file_type)
                all_texts.extend(texts)
            except Exception as e:
                logger.error(f"Error processing file {s3_key}: {e}", exc_info=True)
                # Continue with other files
        
        return all_texts

