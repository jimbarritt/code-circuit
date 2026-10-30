class Api::V1::NotificationsController < ApplicationController
  def index
    render json: Notification.where(account: current_account)
  end

  def clear
    Notification.where(account: current_account).delete_all
  end
end
