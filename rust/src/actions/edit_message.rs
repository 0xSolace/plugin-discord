use async_trait::async_trait;

use super::{ActionContext, ActionResult, DiscordAction};
use crate::error::{DiscordError, Result};
use crate::types::Snowflake;
use crate::DiscordService;

/// Action that edits an existing Discord message.
pub struct EditMessageAction;

#[async_trait]
impl DiscordAction for EditMessageAction {
    fn name(&self) -> &str {
        "EDIT_MESSAGE"
    }

    fn description(&self) -> &str {
        "Edit an existing Discord message. The bot can only edit its own messages."
    }

    fn similes(&self) -> Vec<&str> {
        vec!["UPDATE_MESSAGE", "MODIFY_MESSAGE", "DISCORD_EDIT_MESSAGE"]
    }

    async fn validate(&self, context: &ActionContext) -> Result<bool> {
        let source = context.message.get("source").and_then(|v| v.as_str()).unwrap_or("");
        if source != "discord" {
            return Ok(false);
        }

        // Need channel_id and message_id and new content
        Snowflake::new(context.channel_id.clone())?;

        let has_message_id = context.state.get("message_id")
            .and_then(|v| v.as_str())
            .map(|s| !s.is_empty())
            .unwrap_or(false);

        let has_new_text = context.state.get("new_text")
            .and_then(|v| v.as_str())
            .map(|s| !s.is_empty())
            .unwrap_or(false);

        Ok(has_message_id && has_new_text)
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

        let new_text = context.state.get("new_text")
            .and_then(|v| v.as_str())
            .ok_or_else(|| DiscordError::InvalidArgument("Missing new_text".to_string()))?;

        service.edit_message(&channel_id, &message_id, new_text).await?;

        Ok(ActionResult::success_with_data(
            "Message edited successfully",
            serde_json::json!({
                "message_id": message_id.as_str(),
                "channel_id": channel_id.as_str(),
                "new_text": new_text,
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
        let action = EditMessageAction;
        let context = ActionContext {
            message: json!({"source": "discord", "content": {"text": "edit"}}),
            channel_id: "123456789012345678".to_string(),
            guild_id: Some("987654321098765432".to_string()),
            user_id: "111222333444555666".to_string(),
            state: json!({"message_id": "222333444555666777", "new_text": "updated content"}),
        };
        assert!(action.validate(&context).await.unwrap());
    }

    #[tokio::test]
    async fn test_validate_non_discord() {
        let action = EditMessageAction;
        let context = ActionContext {
            message: json!({"source": "telegram"}),
            channel_id: "123456789012345678".to_string(),
            guild_id: None,
            user_id: "111222333444555666".to_string(),
            state: json!({"message_id": "222333444555666777", "new_text": "updated"}),
        };
        assert!(!action.validate(&context).await.unwrap());
    }

    #[tokio::test]
    async fn test_validate_missing_message_id() {
        let action = EditMessageAction;
        let context = ActionContext {
            message: json!({"source": "discord"}),
            channel_id: "123456789012345678".to_string(),
            guild_id: None,
            user_id: "111222333444555666".to_string(),
            state: json!({"new_text": "updated"}),
        };
        assert!(!action.validate(&context).await.unwrap());
    }

    #[tokio::test]
    async fn test_validate_missing_new_text() {
        let action = EditMessageAction;
        let context = ActionContext {
            message: json!({"source": "discord"}),
            channel_id: "123456789012345678".to_string(),
            guild_id: None,
            user_id: "111222333444555666".to_string(),
            state: json!({"message_id": "222333444555666777"}),
        };
        assert!(!action.validate(&context).await.unwrap());
    }
}
