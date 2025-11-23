# rag/core/kafka_client.py
from kafka import KafkaConsumer, KafkaProducer
from kafka.errors import KafkaError
import json
import logging
from typing import Optional, Callable
from rag.core.config import settings

logger = logging.getLogger(__name__)


class KafkaClient:
    """Kafka client for RAG server - handles consumer and producer."""
    
    def __init__(self):
        self.consumer: Optional[KafkaConsumer] = None
        self.producer: Optional[KafkaProducer] = None
        self._brokers = [b.strip() for b in settings.KAFKA_BROKERS.split(",") if b.strip()]
    
    def _get_kafka_config(self):
        """Get Kafka configuration."""
        config = {
            "bootstrap_servers": self._brokers,
            "client_id": settings.KAFKA_CLIENT_ID,
        }
        
        # SASL configuration - only if explicitly configured
        has_sasl = (
            settings.KAFKA_SASL_MECHANISM 
            and settings.KAFKA_SASL_MECHANISM.strip() 
            and settings.KAFKA_SASL_USERNAME 
            and settings.KAFKA_SASL_USERNAME.strip()
        )
        
        if has_sasl:
            # Use SASL authentication
            config["security_protocol"] = "SASL_SSL" if settings.KAFKA_SSL else "SASL_PLAINTEXT"
            config["sasl_mechanism"] = settings.KAFKA_SASL_MECHANISM.strip()
            config["sasl_plain_username"] = settings.KAFKA_SASL_USERNAME.strip()
            config["sasl_plain_password"] = settings.KAFKA_SASL_PASSWORD.get_secret_value()
        elif settings.KAFKA_SSL:
            # SSL without SASL
            config["security_protocol"] = "SSL"
        else:
            # Plain connection (no authentication, no SSL)
            config["security_protocol"] = "PLAINTEXT"
        
        return config
    
    def create_consumer(self, topics: list[str], group_id: Optional[str] = None) -> KafkaConsumer:
        """Create and configure Kafka consumer."""
        config = self._get_kafka_config()
        config["group_id"] = group_id or settings.KAFKA_GROUP_ID
        config["value_deserializer"] = lambda m: json.loads(m.decode("utf-8"))
        config["auto_offset_reset"] = "latest"
        config["enable_auto_commit"] = True
        
        consumer = KafkaConsumer(*topics, **config)
        logger.info(f"Kafka consumer created for topics: {topics}")
        return consumer
    
    def create_producer(self) -> KafkaProducer:
        """Create and configure Kafka producer."""
        config = self._get_kafka_config()
        config["value_serializer"] = lambda v: json.dumps(v).encode("utf-8")
        
        producer = KafkaProducer(**config)
        logger.info("Kafka producer created")
        return producer
    
    def start_consumer(
        self,
        topics: list[str],
        message_handler: Callable[[dict], None],
        group_id: Optional[str] = None
    ):
        """Start consuming messages from Kafka topics."""
        if not self._brokers:
            logger.warning("No Kafka brokers configured. Consumer disabled.")
            return
        
        try:
            self.consumer = self.create_consumer(topics, group_id)
            logger.info(f"Starting to consume from topics: {topics}")
            
            for message in self.consumer:
                try:
                    value = message.value
                    logger.debug(f"Received message: topic={message.topic}, partition={message.partition}, offset={message.offset}")
                    message_handler(value)
                except Exception as e:
                    logger.error(f"Error processing message: {e}", exc_info=True)
        except KafkaError as e:
            logger.error(f"Kafka consumer error: {e}", exc_info=True)
        except KeyboardInterrupt:
            logger.info("Consumer interrupted by user")
        finally:
            self.close()
    
    def publish(self, topic: str, message: dict, key: Optional[str] = None):
        """Publish a message to a Kafka topic."""
        if not self._brokers:
            logger.warning("No Kafka brokers configured. Producer disabled.")
            return
        
        if not self.producer:
            self.producer = self.create_producer()
        
        try:
            future = self.producer.send(
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
        except Exception as e:
            logger.error(f"Error publishing message: {e}", exc_info=True)
            raise
    
    def close(self):
        """Close consumer and producer connections."""
        if self.consumer:
            self.consumer.close()
            logger.info("Kafka consumer closed")
        if self.producer:
            self.producer.close()
            logger.info("Kafka producer closed")

