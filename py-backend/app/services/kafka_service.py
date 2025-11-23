# app/services/kafka_service.py
from kafka import KafkaProducer, KafkaConsumer
from kafka.errors import KafkaError
import json
import logging
import uuid
from typing import Optional, Dict, Any, Callable
from app.core.config import settings

logger = logging.getLogger(__name__)


class KafkaService:
    """Kafka service for publishing and consuming messages."""
    
    def __init__(self):
        self.producer: Optional[KafkaProducer] = None
        self._brokers = [b.strip() for b in settings.KAFKA_BROKERS.split(",") if b.strip() and settings.KAFKA_BROKERS]
    
    def _get_kafka_config(self):
        """Get Kafka configuration."""
        if not self._brokers:
            return None
        
        config = {
            "bootstrap_servers": self._brokers,
            "client_id": settings.KAFKA_CLIENT_ID,
        }
        
        # SSL configuration
        if settings.KAFKA_SSL:
            config["security_protocol"] = "SSL"
        
        # SASL configuration
        if settings.KAFKA_SASL_MECHANISM and settings.KAFKA_SASL_USERNAME:
            config["security_protocol"] = "SASL_SSL" if settings.KAFKA_SSL else "SASL_PLAINTEXT"
            config["sasl_mechanism"] = settings.KAFKA_SASL_MECHANISM
            config["sasl_plain_username"] = settings.KAFKA_SASL_USERNAME
            config["sasl_plain_password"] = settings.KAFKA_SASL_PASSWORD.get_secret_value()
        
        return config
    
    def get_producer(self) -> Optional[KafkaProducer]:
        """Get or create Kafka producer."""
        if not self._brokers:
            logger.warning("No Kafka brokers configured. Producer disabled.")
            return None
        
        if self.producer is None:
            config = self._get_kafka_config()
            if config:
                try:
                    self.producer = KafkaProducer(
                        value_serializer=lambda v: json.dumps(v).encode("utf-8"),
                        **config
                    )
                    logger.info("Kafka producer created")
                except Exception as e:
                    logger.error(f"Failed to create Kafka producer: {e}", exc_info=True)
                    return None
        
        return self.producer
    
    def publish(self, topic: str, message: Dict[str, Any], key: Optional[str] = None) -> bool:
        """Publish a message to a Kafka topic."""
        producer = self.get_producer()
        if not producer:
            return False
        
        try:
            future = producer.send(
                topic,
                value=message,
                key=key.encode("utf-8") if key else None
            )
            # Wait for the message to be sent
            record_metadata = future.get(timeout=10)
            logger.info(
                f"Message published: topic={record_metadata.topic}, "
                f"partition={record_metadata.partition}, offset={record_metadata.offset}"
            )
            return True
        except Exception as e:
            logger.error(f"Error publishing message: {e}", exc_info=True)
            return False
    
    def create_consumer(
        self,
        topics: list[str],
        group_id: str,
        message_handler: Callable[[Dict[str, Any]], None]
    ) -> Optional[KafkaConsumer]:
        """Create and start a Kafka consumer."""
        if not self._brokers:
            logger.warning("No Kafka brokers configured. Consumer disabled.")
            return None
        
        config = self._get_kafka_config()
        if not config:
            return None
        
        config["group_id"] = group_id
        config["value_deserializer"] = lambda m: json.loads(m.decode("utf-8"))
        config["auto_offset_reset"] = "latest"
        config["enable_auto_commit"] = True
        
        try:
            consumer = KafkaConsumer(*topics, **config)
            logger.info(f"Kafka consumer created for topics: {topics}, group: {group_id}")
            
            # Start consuming in background (would need threading/async in production)
            # For now, return consumer for manual consumption
            return consumer
        except Exception as e:
            logger.error(f"Failed to create Kafka consumer: {e}", exc_info=True)
            return None
    
    def close(self):
        """Close producer connection."""
        if self.producer:
            self.producer.close()
            logger.info("Kafka producer closed")


# Global instance
kafka_service = KafkaService()


def new_request_id() -> str:
    """Generate a new request ID."""
    return str(uuid.uuid4())

