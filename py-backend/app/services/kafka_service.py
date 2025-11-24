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
        print(f"[KAFKA] KafkaService initialized with brokers: {self._brokers}")
    
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
        
        # SASL configuration - only if explicitly configured (non-empty values)
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
            print(f"[KAFKA] Using SASL authentication: mechanism={config['sasl_mechanism']}, username={config['sasl_plain_username']}")
        else:
            # No SASL - use plain connection
            if not settings.KAFKA_SSL:
                config["security_protocol"] = "PLAINTEXT"
            print(f"[KAFKA] Using {config.get('security_protocol', 'PLAINTEXT')} connection (no SASL)")
        
        return config
    
    def get_producer(self) -> Optional[KafkaProducer]:
        """Get or create Kafka producer."""
        if not self._brokers:
            print("[KAFKA] ❌ No Kafka brokers configured. Producer disabled.")
            logger.warning("No Kafka brokers configured. Producer disabled.")
            return None
        
        if self.producer is None:
            config = self._get_kafka_config()
            if config:
                try:
                    # Add metadata configuration for better reliability
                    config["metadata_max_age_ms"] = 300000  # 5 minutes
                    config["request_timeout_ms"] = 30000  # 30 seconds
                    config["retries"] = 3
                    config["max_in_flight_requests_per_connection"] = 1
                    # Reduce metadata wait time
                    config["api_version"] = (0, 10, 1)  # Use a specific API version
                    
                    print(f"[KAFKA] Creating producer with config: brokers={config.get('bootstrap_servers')}, client_id={config.get('client_id')}")
                    print(f"[KAFKA]   metadata_max_age_ms: {config['metadata_max_age_ms']}")
                    print(f"[KAFKA]   request_timeout_ms: {config['request_timeout_ms']}")
                    self.producer = KafkaProducer(
                        value_serializer=lambda v: json.dumps(v).encode("utf-8"),
                        **config
                    )
                    print("[KAFKA] ✅ Kafka producer object created")
                    print("[KAFKA] Note: Producer will connect to Kafka on first send() call")
                    logger.info("Kafka producer created")
                except Exception as e:
                    print(f"[KAFKA] ❌ Failed to create Kafka producer: {e}")
                    logger.error(f"Failed to create Kafka producer: {e}", exc_info=True)
                    return None
        else:
            print("[KAFKA] Using existing producer")
        
        return self.producer
    
    def publish(self, topic: str, message: Dict[str, Any], key: Optional[str] = None) -> bool:
        """Publish a message to a Kafka topic."""
        print("─" * 80)
        print(f"[KAFKA-PRODUCER] 📤 PUBLISHING MESSAGE TO KAFKA")
        print("─" * 80)
        print(f"[KAFKA-PRODUCER]   Topic: {topic}")
        print(f"[KAFKA-PRODUCER]   Key: {key}")
        print(f"[KAFKA-PRODUCER]   Message Type: {message.get('type', 'unknown')}")
        print(f"[KAFKA-PRODUCER]   RequestId: {message.get('requestId', 'N/A')}")
        print(f"[KAFKA-PRODUCER] Full message: {json.dumps(message, indent=2)}")
        
        producer = self.get_producer()
        if not producer:
            print("[KAFKA-PRODUCER] ❌ Cannot publish: Producer not available")
            return False
        
        try:
            print(f"[KAFKA-PRODUCER] Step 1: Attempting to fetch topic metadata...")
            print(f"[KAFKA-PRODUCER]   This will trigger connection to Kafka broker if not already connected")
            import time
            meta_start = time.time()
            
            # Try to get partitions to trigger metadata fetch early and see if it works
            try:
                print(f"[KAFKA-PRODUCER]   Calling producer.partitions_for('{topic}')...")
                partitions = producer.partitions_for(topic)
                meta_elapsed = time.time() - meta_start
                if partitions:
                    print(f"[KAFKA-PRODUCER] ✅ Topic metadata fetched in {meta_elapsed:.2f}s: {len(partitions)} partition(s)")
                else:
                    print(f"[KAFKA-PRODUCER] ⚠️ Topic metadata found but no partitions (topic may not exist)")
            except Exception as meta_err:
                meta_elapsed = time.time() - meta_start
                print(f"[KAFKA-PRODUCER] ⚠️ Metadata fetch failed after {meta_elapsed:.2f}s: {meta_err}")
                print(f"[KAFKA-PRODUCER]   Error type: {type(meta_err).__name__}")
                print(f"[KAFKA-PRODUCER]   Will attempt to send anyway (metadata will be fetched during send)")
            
            print(f"[KAFKA-PRODUCER] Step 2: Calling producer.send()...")
            print(f"[KAFKA-PRODUCER]   This will queue the message and fetch topic metadata if needed")
            print(f"[KAFKA-PRODUCER]   WARNING: If metadata fetch hangs, this may take up to 60 seconds...")
            
            send_start = time.time()
            print(f"[KAFKA-PRODUCER]   [TIMESTAMP] Starting send() at {time.strftime('%H:%M:%S')}")
            future = producer.send(
                topic,
                value=message,
                key=key.encode("utf-8") if key else None
            )
            send_elapsed = time.time() - send_start
            print(f"[KAFKA-PRODUCER] ✅ producer.send() returned in {send_elapsed:.2f}s")
            print(f"[KAFKA-PRODUCER]   [TIMESTAMP] send() completed at {time.strftime('%H:%M:%S')}")
            print(f"[KAFKA-PRODUCER]   Future object created, message queued")
            print(f"[KAFKA-PRODUCER] Step 3: Waiting for Kafka broker acknowledgment (timeout: 10s)...")
            print(f"[KAFKA-PRODUCER]   This confirms the message was written to Kafka")
            
            ack_start = time.time()
            record_metadata = future.get(timeout=10)
            ack_elapsed = time.time() - ack_start
            print(f"[KAFKA-PRODUCER] ✅ Acknowledgment received in {ack_elapsed:.2f}s")
            
            print("─" * 80)
            print(f"[KAFKA-PRODUCER] ✅✅✅ MESSAGE ACKNOWLEDGED BY KAFKA BROKER! ✅✅✅")
            print("─" * 80)
            print(f"[KAFKA-PRODUCER]   Topic: {record_metadata.topic}")
            print(f"[KAFKA-PRODUCER]   Partition: {record_metadata.partition}")
            print(f"[KAFKA-PRODUCER]   Offset: {record_metadata.offset}")
            print(f"[KAFKA-PRODUCER]   Message is now in Kafka and available for consumers")
            print("─" * 80)
            logger.info(
                f"Message published: topic={record_metadata.topic}, "
                f"partition={record_metadata.partition}, offset={record_metadata.offset}"
            )
            return True
        except Exception as e:
            print("─" * 80)
            print(f"[KAFKA-PRODUCER] ❌ ERROR PUBLISHING MESSAGE")
            print("─" * 80)
            print(f"[KAFKA-PRODUCER]   Error: {e}")
            print(f"[KAFKA-PRODUCER]   Error Type: {type(e).__name__}")
            import traceback
            print(f"[KAFKA-PRODUCER] Traceback:")
            print(traceback.format_exc())
            print("─" * 80)
            logger.error(f"Error publishing message: {e}", exc_info=True)
            return False
    
    def create_consumer(
        self,
        topics: list[str],
        group_id: str,
        message_handler: Callable[[Dict[str, Any]], None]
    ) -> Optional[KafkaConsumer]:
        """Create and start a Kafka consumer."""
        print(f"[KAFKA] 📥 Creating consumer for topics: {topics}, group: {group_id}")
        
        if not self._brokers:
            print("[KAFKA] ❌ No Kafka brokers configured. Consumer disabled.")
            logger.warning("No Kafka brokers configured. Consumer disabled.")
            return None
        
        config = self._get_kafka_config()
        if not config:
            print("[KAFKA] ❌ No Kafka config available")
            return None
        
        config["group_id"] = group_id
        config["value_deserializer"] = lambda m: json.loads(m.decode("utf-8"))
        config["auto_offset_reset"] = "latest"
        config["enable_auto_commit"] = True
        
        print(f"[KAFKA] Consumer config: brokers={config.get('bootstrap_servers')}, group_id={group_id}, offset_reset=latest")
        
        try:
            consumer = KafkaConsumer(*topics, **config)
            print(f"[KAFKA] ✅ Kafka consumer created successfully for topics: {topics}")
            logger.info(f"Kafka consumer created for topics: {topics}, group: {group_id}")
            
            # Start consuming in background (would need threading/async in production)
            # For now, return consumer for manual consumption
            return consumer
        except Exception as e:
            print(f"[KAFKA] ❌ Failed to create Kafka consumer: {e}")
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

