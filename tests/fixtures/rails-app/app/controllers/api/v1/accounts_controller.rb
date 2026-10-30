class Api::V1::AccountsController < ApplicationController
  def show
    render json: Account.find(params[:id])
  end

  def follow
    FollowService.new.call(current_account, target_account)
    render json: relationship
  end
end
