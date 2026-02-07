use async_trait::async_trait;

use super::{ActionContext, ActionResult, DiscordAction};
use crate::error::{DiscordError, Result};
use crate::types::Snowflake;
use crate::DiscordService;

/// Action that deletes a Discord message.
pub struct DeleteMessageAction;

#[async_trait]
impl DiscordAction for DeleteMessageAction {
    fn name(&self) -> &str {
        "DELETE_MESSAGE"
    }

    fn description(&self) -> &str {
        "Delete a Discord message. Requires appropriate permissions."
    }

    fn similes(&self) -> Vec<&str> {
        vec!["REMOVE_MESSAGE", "DISCORD_DELETE_MESSAGE"]
    }

    async fn validate(&self, context: &ActionContext) -> Result<bool> {
        let source = context.message.get("source").and_then(|v| v.as_str()).unwrap_or("");
        if source != "discord" {
            return Ok(false);
        }

        Snowflake::new(context.channel_id.clone())?;

        let has_message_id = context.state.get("message_id")
            .and_then(|v| v.as_str())
            .map(|s| !s.is_empty())
            .unwrap_or(false);

        Ok(has_message_id)
    }

    async fn handler(
        &self,
        context: &ActionContext,
        service: &DiscordService,
    ) -> Result<ActionResult> {
        let channel_id = Snowflake::new(context.channel_id.clone())?;

        let message_id_str = context.state.get("message_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| DiscordError::InvalidArgument("Missing message_id".to_string()))?;
        let message_id = Snowflake::new(message_id_str.to_string())?;

        service.delete_message(&channel_id, &message_id).await?;

        Ok(ActionResult::success_with_data(
            "Message deleted successfully",
            serde_json::json!({
                "message_id": message_id.as_str(),
                "channel_id": channel_id.as_str(),
            }),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn test_validate_valid() {
        let action = DeleteMessageAction;
        let context = ActionContext {
            message: json!({"source": "discord"}),
            channel_id: "123456789012345678".to_string(),
            guild_id: Some("987654321098765432".to_string()),
            user_id: "111222333444555666".to_string(),
            state: json!({"message_id": "222333444555666777"}),
        };
        assert!(action.validate(&context).await.unwrap());
    }

    #[tokio::test]
    async fn test_validate_non_discord() {
        let action = DeleteMessageAction;
        let context = ActionContext {
            message: json!({"source": "slack"}),
            channel_id: "123456789012345678".to_string(),
            guild_id: None,
            user_id: "111222333444555666".to_string(),
            state: json!({"message_id": "222333444555666777"}),
        };
        assert!(!action.validate(&context).await.unwrap());
    }

    #[tokio::test]
    async fn test_validate_missing_message_id() {
        let action = DeleteMessageAction;
        let context = ActionContext {
            message: json!({"source": "discord"}),
            channel_id: "123456789012345678".to_string(),
            guild_id: None,
            user_id: "111222333444555666".to_string(),
            state: json!({}),
        };
        assert!(!action.validate(&context).await.unwrap());
    }
}
